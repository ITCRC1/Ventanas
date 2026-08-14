"""Job Cost fiel al Excel: forecast por línea + over/under + draw #

El Excel tiene por línea: Forecasted Total Spend (manual), Over/Under Budget
(forecast − revised) y Current Draw Request (Draw #). Agregamos forecast_total a
wbs_item y ampliamos v_wbs_financials con forecast/over_under/draw_no (columnas
nuevas al final: CREATE OR REPLACE preserva las existentes y sus dependientes).

Revision ID: 0005_jobcost_forecast
Revises: 0004_hardening
Create Date: 2026-07-25
"""

from __future__ import annotations

from alembic import op

revision = "0005_jobcost_forecast"
down_revision = "0004_hardening"
branch_labels = None
depends_on = None

_VIEW = """
CREATE OR REPLACE VIEW v_wbs_financials AS
SELECT w.id, w.wbs_code, w.title, w.owner, w.kind,
       ts.code AS state, c.name AS category, p.name AS phase,
       COALESCE(b.original,0)                        AS budget_original,
       COALESCE(b.changes,0)                         AS budget_change,
       COALESCE(b.original,0)+COALESCE(b.changes,0)  AS budget_revised,
       COALESCE(l.paid,0)                            AS spend,
       COALESCE(b.original,0)+COALESCE(b.changes,0)-COALESCE(l.paid,0) AS remaining,
       -- Forecast: manual si existe, si no el revised (over/under = 0)
       COALESCE(w.forecast_total, COALESCE(b.original,0)+COALESCE(b.changes,0)) AS forecast,
       COALESCE(w.forecast_total, COALESCE(b.original,0)+COALESCE(b.changes,0))
         - (COALESCE(b.original,0)+COALESCE(b.changes,0))                        AS over_under,
       d.draw_no                                     AS draw_no
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
  SELECT SUM(amount_paid_usd) AS paid FROM ledger_entry WHERE wbs_id=w.id) l ON true
LEFT JOIN LATERAL (
  SELECT MAX(di.disb_no) AS draw_no
  FROM disbursement_line dl JOIN disbursement di ON di.id = dl.disbursement_id
  WHERE dl.wbs_id = w.id) d ON true
WHERE w.is_active;
"""

_VIEW_ORIG = """
CREATE OR REPLACE VIEW v_wbs_financials AS
SELECT w.id, w.wbs_code, w.title, w.owner, w.kind,
       ts.code AS state, c.name AS category, p.name AS phase,
       COALESCE(b.original,0)                        AS budget_original,
       COALESCE(b.changes,0)                         AS budget_change,
       COALESCE(b.original,0)+COALESCE(b.changes,0)  AS budget_revised,
       COALESCE(l.paid,0)                            AS spend,
       COALESCE(b.original,0)+COALESCE(b.changes,0)-COALESCE(l.paid,0) AS remaining
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
  SELECT SUM(amount_paid_usd) AS paid FROM ledger_entry WHERE wbs_id=w.id) l ON true
WHERE w.is_active;
"""


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql("ALTER TABLE wbs_item ADD COLUMN IF NOT EXISTS forecast_total numeric(16,2)")
    bind.exec_driver_sql(_VIEW)


def downgrade() -> None:
    bind = op.get_bind()
    # v_timeline / v_timeline_detail dependen de esta vista; CREATE OR REPLACE con
    # menos columnas fallaría, así que se recrean en cascada las que la usan.
    bind.exec_driver_sql("DROP VIEW IF EXISTS v_timeline_month, v_timeline, v_timeline_detail CASCADE")
    bind.exec_driver_sql(_VIEW_ORIG)
    bind.exec_driver_sql("ALTER TABLE wbs_item DROP COLUMN IF EXISTS forecast_total")
