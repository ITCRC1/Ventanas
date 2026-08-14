"""Invoice Receipts — justificación de pago SIN factura (gobierno, comisiones…).

Revision ID: 0036_invoice_no_invoice
Revises: 0035_invoice_fx
Create Date: 2026-07-29
"""

from __future__ import annotations

from alembic import op

revision = "0036_invoice_no_invoice"
down_revision = "0035_invoice_fx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE invoice_receipt ADD COLUMN no_invoice boolean NOT NULL DEFAULT false;")


def downgrade() -> None:
    op.execute("ALTER TABLE invoice_receipt DROP COLUMN no_invoice;")
