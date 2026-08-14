"""Invoice Receipts — bandeja de facturas electrónicas que llegan por correo.

Cada correo entrante con una factura electrónica (XML de Hacienda CR) agrega una
línea; el usuario asocia cada factura al asiento del ledger (donde está el
desembolso) por número de factura.

Revision ID: 0032_invoice_receipts
Revises: 0031_planning_link_receipt
Create Date: 2026-07-29
"""

from __future__ import annotations

from alembic import op

revision = "0032_invoice_receipts"
down_revision = "0031_planning_link_receipt"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE settings ADD COLUMN invoice_last_sync_at timestamptz;")
    op.execute(
        """
        CREATE TABLE invoice_receipt (
          id              bigserial PRIMARY KEY,
          source_uid      text UNIQUE,            -- Message-ID del correo (dedup)
          received_at     timestamptz,            -- fecha del correo
          email_from      text,
          email_subject   text,
          clave           text,                   -- clave numérica 50 díg. (CR)
          invoice_no      text,                   -- consecutivo
          issuer_name     text,
          issuer_id       text,
          invoice_date    date,
          currency        text,
          total           numeric(16,2),
          xml_filename    text,
          has_pdf         boolean NOT NULL DEFAULT false,
          ledger_entry_id bigint REFERENCES ledger_entry(id) ON DELETE SET NULL,
          status          text NOT NULL DEFAULT 'new',  -- new | linked | ignored
          notes           text,
          created_at      timestamptz NOT NULL DEFAULT now()
        );
        """
    )
    op.execute("CREATE INDEX ix_invoice_receipt_clave ON invoice_receipt (clave);")
    op.execute("CREATE INDEX ix_invoice_receipt_status ON invoice_receipt (status);")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS invoice_receipt;")
    op.execute("ALTER TABLE settings DROP COLUMN invoice_last_sync_at;")
