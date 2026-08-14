"""# de factura por línea de Short Payment (fluye al LEDGER al importar).

Revision ID: 0012_line_invoice_no
Revises: 0011_ledger_payment
Create Date: 2026-07-25
"""

from __future__ import annotations

from alembic import op

revision = "0012_line_invoice_no"
down_revision = "0011_ledger_payment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().exec_driver_sql(
        "ALTER TABLE disbursement_line ADD COLUMN IF NOT EXISTS invoice_no text"
    )


def downgrade() -> None:
    op.get_bind().exec_driver_sql(
        "ALTER TABLE disbursement_line DROP COLUMN IF EXISTS invoice_no"
    )
