"""Espejo fiel de la hoja LEDGER del Excel (réplica tal cual).

La tabla normalizada ledger_entry alimenta el motor financiero (SUMIF del Job
Cost), pero para replicar la hoja LEDGER *idéntica* al master hace falta guardar
cada celda como está: el texto del Payee ("Disbursement #00"), PAID TOTAL
("VENTANAS I"), Payment Info, Bank Paid From, etc. — que la carga normalizada
descartó. Esta tabla es un espejo de solo lectura para el tab LEDGER; no la usa
el motor.

Revision ID: 0008_ledger_sheet
Revises: 0007_v_ledger
Create Date: 2026-07-25
"""

from __future__ import annotations

from alembic import op

revision = "0008_ledger_sheet"
down_revision = "0007_v_ledger"
branch_labels = None
depends_on = None


_DDL = """
CREATE TABLE IF NOT EXISTS ledger_sheet_row (
  id             serial PRIMARY KEY,
  row_no         int  NOT NULL,          -- fila del Excel (orden y trazabilidad)
  section        text NOT NULL DEFAULT 'Ledger',
  kind           text NOT NULL DEFAULT 'data',  -- 'data' | 'section' | 'meta'
  cost_code      text,
  account        text,
  entry_date     text,                   -- col C verbatim (casi siempre vacía)
  invoice_no     text,
  payee          text,                   -- "Disbursement #01 - 06/05/2024"
  description    text,
  colones        numeric(16,2),
  amount         numeric(16,2),
  amount_paid    numeric(16,2),
  amount_due     numeric(16,2),
  paid_total     text,                   -- "VENTANAS I" / "VENTANAS II"
  date_paid      text,
  payment_info   text,
  bank_paid_from text,
  request        text,
  notes          text
);
CREATE INDEX IF NOT EXISTS ix_ledger_sheet_row_no ON ledger_sheet_row (row_no);
"""


def upgrade() -> None:
    op.get_bind().exec_driver_sql(_DDL)


def downgrade() -> None:
    op.get_bind().exec_driver_sql("DROP TABLE IF EXISTS ledger_sheet_row")
