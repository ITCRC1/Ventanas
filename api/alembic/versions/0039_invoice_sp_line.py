"""Traza de la factura enviada al Short Payment.

invoice_receipt.sp_line_id apunta a la línea del Short Payment (disbursement_line)
que se creó desde la bandeja de facturas. Si la línea se borra, la factura vuelve
a quedar "sin enviar" (SET NULL) y el botón reaparece.

Revision ID: 0039_invoice_sp_line
Revises: 0038_link_sheet_row
Create Date: 2026-07-30
"""

from __future__ import annotations

from alembic import op

revision = "0039_invoice_sp_line"
down_revision = "0038_link_sheet_row"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE invoice_receipt ADD COLUMN sp_line_id bigint "
        "REFERENCES disbursement_line(id) ON DELETE SET NULL;"
    )
    op.execute("CREATE INDEX ix_invoice_receipt_sp_line ON invoice_receipt (sp_line_id);")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_invoice_receipt_sp_line;")
    op.execute("ALTER TABLE invoice_receipt DROP COLUMN sp_line_id;")
