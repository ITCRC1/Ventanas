"""invoice-void — anular factura por estado en vez de borrarla

El libro es para los dueños: una factura anulada debe QUEDAR en el registro
(auditable), no desaparecer. Se agrega invoice.status ('active'|'void'); la
"anulación" pasa a marcar status='void' en vez de un hard-delete.

Revision ID: 0023_invoice_void
Revises: 0022_disb_edit
Create Date: 2026-07-26
"""

from __future__ import annotations

from alembic import op

revision = "0023_invoice_void"
down_revision = "0022_disb_edit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE invoice
          ADD COLUMN status text NOT NULL DEFAULT 'active'
          CONSTRAINT invoice_status_chk CHECK (status IN ('active', 'void'));
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE invoice DROP COLUMN status;")
