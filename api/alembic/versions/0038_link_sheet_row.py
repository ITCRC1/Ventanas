"""Invoice links apuntan a la línea del LEDGER real (ledger_sheet_row), no al asiento.

Agrega invoice_receipt_link.sheet_row_id (FK a ledger_sheet_row), hace nullable el
viejo ledger_entry_id y crea el índice único (receipt_id, sheet_row_id). El backfill
de los enlaces existentes se hace por script aparte (mapeo cost_code+monto único).

Revision ID: 0038_link_sheet_row
Revises: 0037_invoice_doc_type
Create Date: 2026-07-29
"""

from __future__ import annotations

from alembic import op

revision = "0038_link_sheet_row"
down_revision = "0037_invoice_doc_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE invoice_receipt_link ALTER COLUMN ledger_entry_id DROP NOT NULL;")
    op.execute(
        "ALTER TABLE invoice_receipt_link ADD COLUMN sheet_row_id bigint "
        "REFERENCES ledger_sheet_row(id) ON DELETE CASCADE;"
    )
    op.execute(
        "CREATE UNIQUE INDEX ix_irl_receipt_sheet ON invoice_receipt_link (receipt_id, sheet_row_id)"
        " WHERE sheet_row_id IS NOT NULL;"
    )
    op.execute("CREATE INDEX ix_irl_sheet ON invoice_receipt_link (sheet_row_id);")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_irl_sheet;")
    op.execute("DROP INDEX IF EXISTS ix_irl_receipt_sheet;")
    op.execute("ALTER TABLE invoice_receipt_link DROP COLUMN sheet_row_id;")
