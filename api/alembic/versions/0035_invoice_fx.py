"""Invoice Receipts — TipoCambio implícito del comprobante.

Revision ID: 0035_invoice_fx
Revises: 0034_invoice_receipt_links
Create Date: 2026-07-29
"""

from __future__ import annotations

from alembic import op

revision = "0035_invoice_fx"
down_revision = "0034_invoice_receipt_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE invoice_receipt ADD COLUMN invoice_fx numeric(16,6);")


def downgrade() -> None:
    op.execute("ALTER TABLE invoice_receipt DROP COLUMN invoice_fx;")
