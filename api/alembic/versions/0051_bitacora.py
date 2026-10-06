"""Bitácora del proyecto — `finding_log`, una tabla que sólo crece.

Owner, 2026-10-06: *«quiero ir poniendo todas estas notas importantes para que
queden registradas… ningún blog se puede borrar una vez puesto; cuando se
agregue uno más, sólo se sigue el consecutivo»* y, cuando le dije que un
documento no da esa garantía: *«no se puede borrar ni a mano»*.

De ahí que esto viva en la base y no en un documento. Un archivo compartido lo
edita cualquiera con permiso; acá el motor rechaza el UPDATE y el DELETE, así
que la entrada queda aunque quien la escribió se arrepienta.

## Una corrección NO edita la entrada vieja

Es la misma doctrina de «nada de soft-delete» del resto del esquema: lo que se
corrige entra como entrada NUEVA apuntando con `supersedes` a la que reemplaza.
La bitácora conserva entonces qué se supo y cuándo, que es justamente lo que se
pierde cuando alguien arregla una nota vieja en silencio.

## El consecutivo no puede tener huecos

Un hueco en una bitácora se lee como una entrada borrada, y entonces la tabla
deja de probar lo que tiene que probar. Una `sequence` de Postgres deja hueco
cada vez que una transacción se revierte — el número ya se consumió—, así que
`log_no` se calcula contra la tabla bajo candado de transacción. Serializa los
insertos, que acá son unos pocos al mes.

## Hasta dónde llega la garantía

Esto detiene el borrado accidental y el de cualquiera que use la aplicación.
**No detiene a quien pueda hacer DDL**: con permiso para `DROP TRIGGER` se
puede desarmar. Para eso no alcanza una tabla; haría falta almacenamiento WORM
o una copia fuera de la base. Queda dicho para que nadie lea de más la promesa.

## Por qué no se engancha a `audit_changes`

La tabla **es** su propia bitácora: cada fila trae autor y fecha, y no admite
UPDATE ni DELETE, así que no hay cambio que registrar. Engancharla duplicaría
cada entrada en `audit_log` sin agregar un solo dato.

Revision ID: 0051_bitacora
Revises: 0050_integridad
Create Date: 2026-10-06
"""

from __future__ import annotations

from alembic import op

revision = "0051_bitacora"
down_revision = "0050_integridad"
branch_labels = None
depends_on = None


_TABLA = """
CREATE TABLE IF NOT EXISTS finding_log (
  id          bigserial PRIMARY KEY,
  -- El consecutivo que se ve. Lo pone el trigger, nunca quien inserta.
  log_no      int NOT NULL UNIQUE,
  logged_at   timestamptz NOT NULL DEFAULT now(),
  subject     text NOT NULL,
  finding     text NOT NULL,
  -- Qué hay que hacer con el hallazgo. Puede quedar vacío: una entrada puede
  -- ser sólo constancia de algo que se verificó.
  action      text,
  -- De dónde salió: la cláusula del contrato, el asiento, el mensaje. Sin esto
  -- la entrada no se puede volver a comprobar dentro de un año.
  source      text,
  -- La entrada que ésta reemplaza. No borra nada: las dos quedan.
  supersedes  bigint REFERENCES finding_log(id),
  created_by  int REFERENCES app_user(id),
  CONSTRAINT finding_log_subject_no_vacio CHECK (length(btrim(subject)) > 0),
  CONSTRAINT finding_log_finding_no_vacio CHECK (length(btrim(finding)) > 0),
  CONSTRAINT finding_log_no_se_reemplaza_sola CHECK (supersedes IS DISTINCT FROM id)
);
CREATE INDEX IF NOT EXISTS finding_log_supersedes_idx ON finding_log (supersedes);
"""

_NUMERA = """
CREATE OR REPLACE FUNCTION finding_log_numera() RETURNS trigger AS $$
BEGIN
  -- ⚠️ Candado de transacción, no una `sequence`: una secuencia consume el
  -- número aunque la transacción se revierta, y el hueco que deja se lee como
  -- una entrada borrada — justo lo que esta tabla existe para descartar.
  PERFORM pg_advisory_xact_lock(hashtext('finding_log'));
  SELECT COALESCE(MAX(log_no), 0) + 1 INTO NEW.log_no FROM finding_log;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_finding_log_numera ON finding_log;
CREATE TRIGGER trg_finding_log_numera
  BEFORE INSERT ON finding_log
  FOR EACH ROW EXECUTE FUNCTION finding_log_numera();
"""

_INMUTABLE = """
CREATE OR REPLACE FUNCTION finding_log_inmutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'La bitácora no se vacía.'
      USING ERRCODE = 'restrict_violation',
            HINT = 'Una corrección entra como entrada nueva con supersedes.';
  END IF;
  RAISE EXCEPTION 'La entrada % de la bitácora no se modifica ni se borra.', OLD.log_no
    USING ERRCODE = 'restrict_violation',
          HINT = 'Una corrección entra como entrada nueva con supersedes.';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_finding_log_inmutable ON finding_log;
CREATE TRIGGER trg_finding_log_inmutable
  BEFORE UPDATE OR DELETE ON finding_log
  FOR EACH ROW EXECUTE FUNCTION finding_log_inmutable();

DROP TRIGGER IF EXISTS trg_finding_log_no_truncate ON finding_log;
CREATE TRIGGER trg_finding_log_no_truncate
  BEFORE TRUNCATE ON finding_log
  FOR EACH STATEMENT EXECUTE FUNCTION finding_log_inmutable();
"""

# Segunda capa, por si alguien entra con otro rol: el trigger ya lo impide, pero
# un permiso que nunca se otorgó es una puerta menos que cerrar.
_PERMISOS_SQL = """
REVOKE UPDATE, DELETE, TRUNCATE ON finding_log FROM PUBLIC;
"""

_VISTA = """
CREATE OR REPLACE VIEW v_finding_log AS
SELECT f.log_no,
       f.logged_at,
       f.subject,
       f.finding,
       f.action,
       f.source,
       s.log_no                                   AS reemplaza_a,
       EXISTS (SELECT 1 FROM finding_log x
                WHERE x.supersedes = f.id)        AS fue_reemplazada,
       COALESCE(u.full_name, '')                  AS autor
FROM finding_log f
LEFT JOIN finding_log s ON s.id = f.supersedes
LEFT JOIN app_user    u ON u.id = f.created_by
ORDER BY f.log_no;
"""

# El permiso de escribir en la bitácora es propio: leerla es parte de ver
# reportes, pero dejar constancia la firma alguien.
_PERMISO = """
INSERT INTO permission (code, description) VALUES
  ('blog.post', 'Registrar entradas en la bitácora del proyecto')
ON CONFLICT (code) DO NOTHING;

-- ⚠️ `role_permission` liga por el CÓDIGO del permiso, no por un id:
-- `permission` tiene `code` de llave primaria y no tiene columna `id`.
INSERT INTO role_permission (role_id, permission)
SELECT r.id, 'blog.post'
FROM role r
WHERE r.code IN ('controller', 'pm')
ON CONFLICT DO NOTHING;
"""


def upgrade() -> None:
    op.execute(_TABLA)
    op.execute(_NUMERA)
    op.execute(_INMUTABLE)
    op.execute(_PERMISOS_SQL)
    op.execute(_VISTA)
    op.execute(_PERMISO)


def downgrade() -> None:
    # ⚠️ El downgrade BORRA la bitácora, que es lo único que esta migración
    # existe para impedir. Se deja porque Alembic lo pide y porque en
    # desarrollo hace falta, pero contra producción es justamente la operación
    # que no se corre.
    op.execute("DROP VIEW IF EXISTS v_finding_log;")
    op.execute("DROP TRIGGER IF EXISTS trg_finding_log_no_truncate ON finding_log;")
    op.execute("DROP TRIGGER IF EXISTS trg_finding_log_inmutable ON finding_log;")
    op.execute("DROP TRIGGER IF EXISTS trg_finding_log_numera ON finding_log;")
    op.execute("DROP FUNCTION IF EXISTS finding_log_inmutable();")
    op.execute("DROP FUNCTION IF EXISTS finding_log_numera();")
    op.execute("DROP TABLE IF EXISTS finding_log;")
    op.execute("DELETE FROM permission WHERE code = 'blog.post';")
