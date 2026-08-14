"""Spend del Job Cost pegado al tab LEDGER (ledger_sheet_row) por cost_code.

Antes el Spend salía de ledger_entry (ledger normalizado viejo, $1.4M) y NO
coincidía con el tab LEDGER que edita el owner (ledger_sheet_row, $11.3M). Ahora
Spend = SUM(ledger_sheet_row.amount_paid WHERE cost_code = wbs_code) → pega al
100% y cualquier cambio en el Ledger actualiza el Job Cost. Remaining y Forecast
usan ese mismo Spend.

Revision ID: 0015_spend_from_ledger
Revises: 0014_forecast_timeline
Create Date: 2026-07-25
"""

from __future__ import annotations

from alembic import op

revision = "0015_spend_from_ledger"
down_revision = "0014_forecast_timeline"
branch_labels = None
depends_on = None

_VIEW = """
CREATE OR REPLACE VIEW v_wbs_financials AS
SELECT w.id, w.wbs_code, w.title, w.owner, w.kind,
       ts.code AS state, c.name AS category, p.name AS phase,
       COALESCE(w.budget_original_ovr, b.original, 0)                       AS budget_original,
       COALESCE(w.budget_change_ovr,   b.changes,  0)                       AS budget_change,
       COALESCE(w.budget_original_ovr, b.original, 0)
         + COALESCE(w.budget_change_ovr, b.changes, 0)                      AS budget_revised,
       -- Spend pegado al tab LEDGER (ledger_sheet_row) por cost_code
       COALESCE(lsr.paid, 0)                                                AS spend,
       COALESCE(w.budget_original_ovr, b.original, 0)
         + COALESCE(w.budget_change_ovr, b.changes, 0)
         - COALESCE(lsr.paid, 0)                                            AS remaining,
       COALESCE(w.forecast_total,
                COALESCE(lsr.paid, 0) + COALESCE(tlf.future, 0))            AS forecast,
       COALESCE(w.forecast_total,
                COALESCE(lsr.paid, 0) + COALESCE(tlf.future, 0))
         - (COALESCE(w.budget_original_ovr, b.original, 0)
              + COALESCE(w.budget_change_ovr, b.changes, 0))                AS over_under,
       d.draw_no                                                            AS draw_no
FROM wbs_item w
JOIN task_state ts ON ts.id = w.state_id
LEFT JOIN category c ON c.id = w.category_id
LEFT JOIN phase    p ON p.id = w.phase_id
LEFT JOIN LATERAL (
  SELECT SUM(amount) FILTER (WHERE v.version_no=1) AS original,
         SUM(amount) FILTER (WHERE v.version_no>1) AS changes
  FROM budget_line bl JOIN budget_version v ON v.id=bl.version_id
  WHERE bl.wbs_id=w.id) b ON true
LEFT JOIN LATERAL (
  SELECT SUM(amount_paid) AS paid
  FROM ledger_sheet_row
  WHERE cost_code = w.wbs_code AND kind = 'data') lsr ON true
LEFT JOIN LATERAL (
  SELECT SUM(planned_amount) AS future
  FROM schedule_cell
  WHERE wbs_id = w.id
    AND week_start >= COALESCE((SELECT cutoff_date FROM settings LIMIT 1), DATE '1900-01-01')
) tlf ON true
LEFT JOIN LATERAL (
  SELECT MAX(di.disb_no) AS draw_no
  FROM disbursement_line dl JOIN disbursement di ON di.id = dl.disbursement_id
  WHERE dl.wbs_id = w.id) d ON true
WHERE w.is_active;
"""


def upgrade() -> None:
    op.get_bind().exec_driver_sql(_VIEW)


def downgrade() -> None:
    pass
