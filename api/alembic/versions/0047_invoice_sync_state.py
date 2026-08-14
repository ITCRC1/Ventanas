"""Estado del sync de facturas en la base (no en memoria).

El backend corre con 2 workers: si el estado del sync vive en la memoria del
proceso, la pantalla puede preguntarle al worker que NO está sincronizando y ver
"no pasa nada" mientras el otro trabaja. Se guarda en `settings` para que todos
los workers (y todos los usuarios) vean lo mismo.

Revision ID: 0047_invoice_sync_state
Revises: 0046_ledger_import_rows_inside
Create Date: 2026-08-07
"""

from __future__ import annotations

from alembic import op

revision = "0047_invoice_sync_state"
down_revision = "0046_ledger_import_rows_inside"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE settings ADD COLUMN invoice_sync_state jsonb;")


def downgrade() -> None:
    op.execute("ALTER TABLE settings DROP COLUMN invoice_sync_state;")
