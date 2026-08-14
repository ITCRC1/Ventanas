"""lafise-balance — saldo actual de la cuenta Ventanas LAFISE (editable).

Va en settings (fila única). Se muestra al pie del tab US Wire Transfers.

Revision ID: 0025_lafise_balance
Revises: 0024_us_wire_sheet
Create Date: 2026-07-26
"""

from __future__ import annotations

from alembic import op

revision = "0025_lafise_balance"
down_revision = "0024_us_wire_sheet"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE settings ADD COLUMN lafise_balance numeric(16,2);")


def downgrade() -> None:
    op.execute("ALTER TABLE settings DROP COLUMN lafise_balance;")
