"""Auditoría: capturar lo que hoy no queda registrado.

Antes de esto la bitácora solo veía UPDATE sobre cuatro tablas, y se perdían
justo los cambios que hay que poder auditar:

  · el presupuesto — `wbs_item` no vigilaba budget_original_ovr / budget_change_ovr
    / forecast_total, y `budget_line` no tenía trigger;
  · mover plata de un mes a otro — `schedule_cell` solo tenía UPDATE, y mover una
    celda es DELETE + INSERT;
  · el LEDGER — el trigger estaba en `ledger_entry`, pero el tab que se edita es
    `ledger_sheet_row`, sin auditoría;
  · el corte y el horizonte — `settings` sin auditoría.

Agrega op / wbs_code / context / batch a la bitácora para poder responder "qué
cambió, en qué proyecto y de qué fila", y una función nueva que entiende INSERT
y DELETE. `wbs_code` es lo que permite agrupar por proyecto sin re-resolverlo en
cada consulta; `context` identifica la fila afectada (la semana, el # de fila del
Ledger) porque tras un DELETE el record_id ya no resuelve a nada.

`batch` etiqueta las corridas masivas: traer el historial del LEDGER reescribe
cientos de celdas y sin esto la bitácora se vuelve ilegible.

Qué queda con INSERT/DELETE y qué se deja en UPDATE:
  `wbs_item`, `disbursement` y `ledger_entry` se quedan en UPDATE. db/test_suite.sql
  afirma conteos EXACTOS de audit_log sobre esas dos primeras; auditar sus INSERT
  agregaría filas y las pruebas fallarían. Son tablas de poco movimiento y el alta
  ya se ve en el dato mismo.

Revision ID: 0049_audit_captura
Revises: 0048_ledger_beneficiary
Create Date: 2026-09-29
"""

from __future__ import annotations

from alembic import op

revision = "0049_audit_captura"
down_revision = "0048_ledger_beneficiary"
branch_labels = None
depends_on = None


_COLUMNAS = """
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS op        text NOT NULL DEFAULT 'UPDATE';
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS wbs_code  text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS context   text;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS batch     text;
CREATE INDEX IF NOT EXISTS ix_audit_log_wbs   ON audit_log (wbs_code, changed_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_log_user  ON audit_log (user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS ix_audit_log_batch ON audit_log (batch) WHERE batch IS NOT NULL;
"""

# TG_ARGV[0] = proyecto: 'none' | 'code:<col>' (la fila trae el wbs_code) |
#                        'id:<col>' (la fila trae el id y se resuelve)
# TG_ARGV[1] = columna de contexto, o 'none'
# TG_ARGV[2..] = columnas vigiladas
_FUNCION = """
CREATE OR REPLACE FUNCTION audit_changes() RETURNS trigger AS $$
DECLARE
  jold jsonb; jnew jsonb; jfila jsonb;
  rid bigint; wbs text; ctx text;
  modo text; fuente text; col text; oldv text; newv text;
  ref int; i int;
BEGIN
  -- to_jsonb resuelve por NOMBRE de columna. La version con SQL dinamico
  -- (EXECUTE 'SELECT ($1).id' USING fila) fallaba en `settings`: sobre un
  -- record anonimo el acceso por atributo no siempre resuelve por nombre.
  -- Ademas esto evita un EXECUTE por columna y por fila.
  IF TG_OP <> 'INSERT' THEN jold := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN jnew := to_jsonb(NEW); END IF;
  jfila := COALESCE(jnew, jold);

  -- `settings` es una tabla de un solo registro y su `id` es BOOLEAN (existe
  -- solo para forzar la fila unica), asi que no cabe en record_id. Ahi se
  -- guarda 0: la tabla ya identifica el registro, no hay otro.
  rid := CASE WHEN jsonb_typeof(jfila->'id') = 'number'
              THEN (jfila->>'id')::bigint ELSE 0 END;

  modo   := split_part(TG_ARGV[0], ':', 1);
  fuente := split_part(TG_ARGV[0], ':', 2);
  IF modo = 'code' THEN
    wbs := jfila->>fuente;
  ELSIF modo = 'id' THEN
    ref := NULLIF(jfila->>fuente, '')::int;
    IF ref IS NOT NULL THEN
      SELECT w.wbs_code INTO wbs FROM wbs_item w WHERE w.id = ref;
    END IF;
  END IF;

  IF TG_ARGV[1] <> 'none' THEN ctx := jfila->>TG_ARGV[1]; END IF;

  FOR i IN 2 .. TG_NARGS - 1 LOOP
    col  := TG_ARGV[i];
    oldv := jold->>col;
    newv := jnew->>col;
    IF oldv IS DISTINCT FROM newv THEN
      INSERT INTO audit_log(table_name, record_id, field, old_value, new_value,
                            user_id, op, wbs_code, context, batch)
      VALUES (TG_TABLE_NAME, rid, col, oldv, newv, current_app_user(), TG_OP, wbs, ctx,
              NULLIF(current_setting('app.audit_batch', true), ''));
    END IF;
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
"""

# INSERT + UPDATE + DELETE: acá viven las preguntas que hay que poder contestar.
_COMPLETOS = [
    ("schedule_cell", "id:wbs_id", "week_start", "planned_amount, state_id"),
    ("ledger_sheet_row", "code:cost_code", "row_no",
     "cost_code, entry_date, amount, amount_paid, description, payee, invoice_no, beneficiary"),
    ("budget_line", "id:wbs_id", "version_id", "amount"),
    ("settings", "none", "none",
     "cutoff_date, horizon_start, horizon_end, project_name, invoice_ref_fx"),
    ("disbursement_line", "id:wbs_id", "line_no",
     "description, amount, amount_paid, payee_id, wbs_id, transfer, invoice_no, vendor"),
    ("payee", "none", "name", "name, bank_name, iban, legal_id, is_active"),
]

# Solo UPDATE (ver la nota del encabezado sobre test_suite.sql).
_SOLO_UPDATE = [
    ("wbs_item", "code:wbs_code", "wbs_code",
     "title, category_id, phase_id, state_id, kind, is_active, "
     "budget_original_ovr, budget_change_ovr, forecast_total, spend_ovr"),
    ("disbursement", "none", "disb_no",
     "status, total_amount, credit_applied, approved_by, period_month, send_date"),
    ("ledger_entry", "id:wbs_id", "invoice_no", "amount, amount_paid, wbs_id, fx_rate, status"),
]

_VIEJOS = ["trg_audit_wbs:wbs_item", "trg_audit_disb:disbursement",
           "trg_audit_cell:schedule_cell", "trg_audit_ledger:ledger_entry"]


def _args(proyecto: str, contexto: str, cols: str) -> str:
    partes = [proyecto, contexto] + [c.strip() for c in cols.split(",")]
    return ", ".join(f"'{p}'" for p in partes)


def upgrade() -> None:
    op.execute(_COLUMNAS)
    op.execute(_FUNCION)
    for spec in _VIEJOS:
        tg, tabla = spec.split(":")
        op.execute(f"DROP TRIGGER IF EXISTS {tg} ON {tabla};")
    for tabla, proyecto, contexto, cols in _COMPLETOS:
        op.execute(f"DROP TRIGGER IF EXISTS trg_audit_{tabla} ON {tabla};")
        op.execute(
            f"CREATE TRIGGER trg_audit_{tabla} AFTER INSERT OR UPDATE OR DELETE ON {tabla} "
            f"FOR EACH ROW EXECUTE FUNCTION audit_changes({_args(proyecto, contexto, cols)});"
        )
    for tabla, proyecto, contexto, cols in _SOLO_UPDATE:
        op.execute(f"DROP TRIGGER IF EXISTS trg_audit_{tabla} ON {tabla};")
        op.execute(
            f"CREATE TRIGGER trg_audit_{tabla} AFTER UPDATE ON {tabla} "
            f"FOR EACH ROW EXECUTE FUNCTION audit_changes({_args(proyecto, contexto, cols)});"
        )


def downgrade() -> None:
    for tabla, _p, _c, _x in _COMPLETOS + _SOLO_UPDATE:
        op.execute(f"DROP TRIGGER IF EXISTS trg_audit_{tabla} ON {tabla};")
    op.execute("DROP FUNCTION IF EXISTS audit_changes();")
    # Se reponen los cuatro triggers originales sobre audit_columns().
    op.execute("""
        CREATE TRIGGER trg_audit_wbs AFTER UPDATE ON wbs_item
          FOR EACH ROW EXECUTE FUNCTION audit_columns('category_id','phase_id','state_id','title','kind');
        CREATE TRIGGER trg_audit_disb AFTER UPDATE ON disbursement
          FOR EACH ROW EXECUTE FUNCTION audit_columns('status','total_amount','credit_applied','approved_by');
        CREATE TRIGGER trg_audit_cell AFTER UPDATE ON schedule_cell
          FOR EACH ROW EXECUTE FUNCTION audit_columns('planned_amount','state_id');
        CREATE TRIGGER trg_audit_ledger AFTER UPDATE ON ledger_entry
          FOR EACH ROW EXECUTE FUNCTION audit_columns('amount','amount_paid','wbs_id','fx_rate','status');
    """)
    op.execute("DROP INDEX IF EXISTS ix_audit_log_batch;")
    op.execute("DROP INDEX IF EXISTS ix_audit_log_user;")
    op.execute("DROP INDEX IF EXISTS ix_audit_log_wbs;")
    for c in ("batch", "context", "wbs_code", "op"):
        op.execute(f"ALTER TABLE audit_log DROP COLUMN IF EXISTS {c};")
