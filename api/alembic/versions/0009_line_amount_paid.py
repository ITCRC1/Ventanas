"""Amount Paid + variance por línea de Short Payment (para el reflejo en el LEDGER).

El LEDGER refleja los Short Payments desde ago-2026: cada línea muestra Amount
(lo planificado) y Amount Paid (lo realmente pagado, editable); Amount Due es la
varianza = amount - amount_paid, columna generada por Postgres (no se recalcula
en la app, §6 DECISIONES).

Revision ID: 0009_line_amount_paid
Revises: 0008_ledger_sheet
Create Date: 2026-07-25
"""

from __future__ import annotations

from alembic import op

revision = "0009_line_amount_paid"
down_revision = "0008_ledger_sheet"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        "ALTER TABLE disbursement_line "
        "ADD COLUMN IF NOT EXISTS amount_paid numeric(16,2) NOT NULL DEFAULT 0"
    )
    op.get_bind().exec_driver_sql(
        "ALTER TABLE disbursement_line "
        "ADD COLUMN IF NOT EXISTS amount_due numeric(16,2) "
        "GENERATED ALWAYS AS (amount - amount_paid) STORED"
    )


def downgrade() -> None:
    op.get_bind().exec_driver_sql("ALTER TABLE disbursement_line DROP COLUMN IF EXISTS amount_due")
    op.get_bind().exec_driver_sql("ALTER TABLE disbursement_line DROP COLUMN IF EXISTS amount_paid")
