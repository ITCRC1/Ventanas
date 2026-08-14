"""Invoice Receipts — subtotal/impuesto + guardar XML y PDF para ver/descargar.

Revision ID: 0033_invoice_receipt_files
Revises: 0032_invoice_receipts
Create Date: 2026-07-29
"""

from __future__ import annotations

from alembic import op

revision = "0033_invoice_receipt_files"
down_revision = "0032_invoice_receipts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE invoice_receipt ADD COLUMN subtotal numeric(16,2);")
    op.execute("ALTER TABLE invoice_receipt ADD COLUMN tax numeric(16,2);")
    op.execute("ALTER TABLE invoice_receipt ADD COLUMN pdf_filename text;")
    op.execute("ALTER TABLE invoice_receipt ADD COLUMN xml_bytes bytea;")
    op.execute("ALTER TABLE invoice_receipt ADD COLUMN pdf_bytes bytea;")


def downgrade() -> None:
    op.execute("ALTER TABLE invoice_receipt DROP COLUMN subtotal;")
    op.execute("ALTER TABLE invoice_receipt DROP COLUMN tax;")
    op.execute("ALTER TABLE invoice_receipt DROP COLUMN pdf_filename;")
    op.execute("ALTER TABLE invoice_receipt DROP COLUMN xml_bytes;")
    op.execute("ALTER TABLE invoice_receipt DROP COLUMN pdf_bytes;")
