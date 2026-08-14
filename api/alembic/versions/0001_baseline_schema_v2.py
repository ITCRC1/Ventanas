"""baseline — reproduce db/schema_v2.sql tal cual (38 tablas, 22 vistas)

La primera migración NO rediseña el modelo: ejecuta el esquema ya validado con
78 pruebas (§1 DECISIONES). Cualquier cambio posterior va en migraciones nuevas.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-07-24
"""

from __future__ import annotations

from pathlib import Path

from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

# api/alembic/versions/este_archivo -> parents[3] = raíz del repo
_SCHEMA = Path(__file__).resolve().parents[3] / "db" / "schema_v2.sql"


def upgrade() -> None:
    sql = _SCHEMA.read_text(encoding="utf-8")
    # psycopg3 interpreta '%' como placeholder (los mensajes RAISE EXCEPTION del
    # esquema los usan). Doblarlos -> psycopg los colapsa a '%' al enviar, sin
    # que el archivo schema_v2.sql cambie.
    op.get_bind().exec_driver_sql(sql.replace("%", "%%"))


def downgrade() -> None:
    # Baseline: revertir = dejar el esquema public vacío.
    op.get_bind().exec_driver_sql("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
