"""Vista v_ledger: el libro de asientos del Excel (hoja LEDGER) con nombres resueltos.

La hoja LEDGER del master muestra Cost Code, Account, Date, Invoice #, Payee,
Description, Colones, Amount, Amount Paid, Amount Due, Paid y Notes. La tabla
ledger_entry guarda IDs (wbs_id, payee_id); esta vista los resuelve a texto para
que el frontend replique la hoja sin recalcular nada (§1 DECISIONES).

El bloque escrow del Excel (REQUESTED / RECEIVED IN ESCROW / RELEASED FROM ESCROW
/ REMAINING) ya vive en v_disbursement_trace y se consume aparte.

Revision ID: 0007_v_ledger
Revises: 0006_line_transfer
Create Date: 2026-07-25
"""

from __future__ import annotations

from alembic import op

revision = "0007_v_ledger"
down_revision = "0006_line_transfer"
branch_labels = None
depends_on = None


_VIEW = """
CREATE OR REPLACE VIEW v_ledger AS
SELECT
  le.id,
  w.wbs_code                               AS cost_code,
  w.title                                  AS account,
  le.entry_date,
  le.invoice_no,
  COALESCE(
    p.name,
    CASE WHEN le.disbursement_id IS NOT NULL
         THEN 'Disbursement #' || le.disbursement_id::text END
  )                                        AS payee,
  le.description,
  CASE WHEN le.currency = 'CRC' THEN le.amount END AS colones,
  le.amount_usd                            AS amount,
  le.amount_paid_usd                       AS amount_paid,
  (le.amount_usd - le.amount_paid_usd)     AS amount_due,
  s.label                                  AS status,
  le.funding_source                        AS bank_paid_from,
  le.released_reason                       AS notes
FROM ledger_entry le
LEFT JOIN wbs_item      w ON w.id   = le.wbs_id
LEFT JOIN payee         p ON p.id   = le.payee_id
LEFT JOIN ledger_status s ON s.code = le.status
ORDER BY le.entry_date NULLS LAST, w.wbs_code, le.id
"""


def upgrade() -> None:
    op.get_bind().exec_driver_sql(_VIEW)


def downgrade() -> None:
    op.get_bind().exec_driver_sql("DROP VIEW IF EXISTS v_ledger")
