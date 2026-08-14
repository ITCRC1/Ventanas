"""Pagos en cuotas: un pago con total, repartido en varias líneas del LEDGER.

A veces un pago (ej. una factura de $10.000) se paga en cuotas a través de varios
Disbursements ($4.000 en uno, $6.000 en otro). `ledger_payment` guarda el total;
`ledger_sheet_row.payment_id` liga cada cuota. El saldo = total − suma de cuotas.

Revision ID: 0011_ledger_payment
Revises: 0010_ledger_src_disb
Create Date: 2026-07-25
"""

from __future__ import annotations

from alembic import op

revision = "0011_ledger_payment"
down_revision = "0010_ledger_src_disb"
branch_labels = None
depends_on = None


_DDL = """
CREATE TABLE IF NOT EXISTS ledger_payment (
  id           serial PRIMARY KEY,
  label        text NOT NULL,
  total_amount numeric(16,2) NOT NULL,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ledger_sheet_row
  ADD COLUMN IF NOT EXISTS payment_id int REFERENCES ledger_payment(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_ledger_sheet_row_payment ON ledger_sheet_row (payment_id);
"""


def upgrade() -> None:
    op.get_bind().exec_driver_sql(_DDL)


def downgrade() -> None:
    op.get_bind().exec_driver_sql(
        "ALTER TABLE ledger_sheet_row DROP COLUMN IF EXISTS payment_id"
    )
    op.get_bind().exec_driver_sql("DROP TABLE IF EXISTS ledger_payment")
