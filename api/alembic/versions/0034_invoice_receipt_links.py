"""Invoice Receipts — enlace muchos-a-muchos factura↔asientos del ledger.

Una factura puede cubrir varios desembolsos: se marcan con check varios asientos.

Revision ID: 0034_invoice_receipt_links
Revises: 0033_invoice_receipt_files
Create Date: 2026-07-29
"""

from __future__ import annotations

from alembic import op

revision = "0034_invoice_receipt_links"
down_revision = "0033_invoice_receipt_files"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE invoice_receipt_link (
          id             bigserial PRIMARY KEY,
          receipt_id     bigint NOT NULL REFERENCES invoice_receipt(id) ON DELETE CASCADE,
          ledger_entry_id bigint NOT NULL REFERENCES ledger_entry(id) ON DELETE CASCADE,
          created_at     timestamptz NOT NULL DEFAULT now(),
          UNIQUE (receipt_id, ledger_entry_id)
        );
        """
    )
    op.execute("CREATE INDEX ix_irl_receipt ON invoice_receipt_link (receipt_id);")
    op.execute("CREATE INDEX ix_irl_ledger ON invoice_receipt_link (ledger_entry_id);")
    # Migrar los enlaces simples ya existentes (columna ledger_entry_id) a la tabla.
    op.execute(
        """
        INSERT INTO invoice_receipt_link (receipt_id, ledger_entry_id)
        SELECT id, ledger_entry_id FROM invoice_receipt
        WHERE ledger_entry_id IS NOT NULL
        ON CONFLICT DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS invoice_receipt_link;")
