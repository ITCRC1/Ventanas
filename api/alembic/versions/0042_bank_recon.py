"""Conciliación bancaria: histórico de estados subidos + link banco↔ledger.

El tab "Bank Reconciliation" sube el estado de cuenta LAFISE (PDF/CSV/xls) y
cruza cada movimiento contra el pago del Ledger (`ledger_sheet_row`), de donde
cuelgan el # de Short Payment (`src_disb_no`), la factura y el proveedor.

- `bank_statement`: un registro por estado subido (período, archivo, saldos,
  #movimientos, origen). Es el histórico.
- `bank_tx` gana: `statement_id` (a qué estado pertenece), `recon_sheet_row_id`
  (el pago del Ledger con el que concilia), `recon_note`, `recon_at`.

No se toca `reconciled_ledger_id` (legado, apuntaba a `ledger_entry`): el módulo
de facturas ya decidió que la verdad vive en `ledger_sheet_row`, así que la
conciliación bancaria se ata a la misma tabla.

Revision ID: 0042_bank_recon
Revises: 0041_ledger_sheet_dates
Create Date: 2026-07-31
"""

from __future__ import annotations

from alembic import op

revision = "0042_bank_recon"
down_revision = "0041_ledger_sheet_dates"
branch_labels = None
depends_on = None


_DDL = """
CREATE TABLE IF NOT EXISTS bank_statement (
  id             serial PRIMARY KEY,
  account_id     int  NOT NULL REFERENCES bank_account(id),
  period_from    date,
  period_to      date,
  filename       text,
  source_kind    text NOT NULL DEFAULT 'pdf',   -- pdf | csv | xls
  opening_balance numeric(16,2),
  closing_balance numeric(16,2),
  n_movements    int  NOT NULL DEFAULT 0,
  n_new          int  NOT NULL DEFAULT 0,
  batch          text,                            -- mismo hash que bank_tx.import_batch
  uploaded_by    text,
  uploaded_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_bank_statement_acc ON bank_statement (account_id, period_from);

ALTER TABLE bank_tx ADD COLUMN IF NOT EXISTS statement_id int
  REFERENCES bank_statement(id) ON DELETE SET NULL;
ALTER TABLE bank_tx ADD COLUMN IF NOT EXISTS recon_sheet_row_id int
  REFERENCES ledger_sheet_row(id) ON DELETE SET NULL;
ALTER TABLE bank_tx ADD COLUMN IF NOT EXISTS recon_note text;
ALTER TABLE bank_tx ADD COLUMN IF NOT EXISTS recon_at timestamptz;

CREATE INDEX IF NOT EXISTS ix_bank_tx_recon_row ON bank_tx (recon_sheet_row_id);
CREATE INDEX IF NOT EXISTS ix_bank_tx_statement ON bank_tx (statement_id);
"""


def upgrade() -> None:
    op.get_bind().exec_driver_sql(_DDL)


def downgrade() -> None:
    op.get_bind().exec_driver_sql(
        """
        ALTER TABLE bank_tx DROP COLUMN IF EXISTS recon_at;
        ALTER TABLE bank_tx DROP COLUMN IF EXISTS recon_note;
        ALTER TABLE bank_tx DROP COLUMN IF EXISTS recon_sheet_row_id;
        ALTER TABLE bank_tx DROP COLUMN IF EXISTS statement_id;
        DROP TABLE IF EXISTS bank_statement;
        """
    )
