"""Invoice Receipts — tipo de documento (FE/NC/ND…) del comprobante.

Revision ID: 0037_invoice_doc_type
Revises: 0036_invoice_no_invoice
Create Date: 2026-07-29
"""

from __future__ import annotations

from alembic import op

revision = "0037_invoice_doc_type"
down_revision = "0036_invoice_no_invoice"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE invoice_receipt ADD COLUMN doc_type text;")


def downgrade() -> None:
    op.execute("ALTER TABLE invoice_receipt DROP COLUMN doc_type;")
