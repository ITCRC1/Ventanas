"""Forecast = Spend + timeline futuro (desde settings.cutoff_date), como el Excel.

Antes: forecast = COALESCE(forecast_total_manual, revised) → se movía con el
Revised, no con el cronograma. Ahora: forecast = Spend + suma del timeline desde
la fecha de corte hacia adelante (el forecast_total manual sigue como override
opcional). Se siembra la fila de settings con una fecha de corte editable.

Revision ID: 0014_forecast_timeline
Revises: 0013_jobcost_editable
Create Date: 2026-07-25
"""

from __future__ import annotations

from alembic import op

revision = "0014_forecast_timeline"
down_revision = "0013_jobcost_editable"
branch_labels = None
depends_on = None

_SEED = """
INSERT INTO settings (id, project_name, cutoff_date, horizon_start, horizon_end)
VALUES (true, 'Ventanas', DATE '2026-08-01', DATE '2024-09-30', DATE '2028-01-24')
ON CONFLICT (id) DO NOTHING;
"""

_VIEW = """
CREATE OR REPLACE VIEW v_wbs_financials AS
SELECT w.id, w.wbs_code, w.title, w.owner, w.kind,
       ts.code AS state, c.name AS category, p.name AS phase,
       COALESCE(w.budget_original_ovr, b.original, 0)                       AS budget_original,
       COALESCE(w.budget_change_ovr,   b.changes,  0)                       AS budget_change,
       COALESCE(w.budget_original_ovr, b.original, 0)
         + COALESCE(w.budget_change_ovr, b.changes, 0)                      AS budget_revised,
       COALESCE(w.spend_ovr, l.paid, 0)                                     AS spend,
       COALESCE(w.budget_original_ovr, b.original, 0)
         + COALESCE(w.budget_change_ovr, b.changes, 0)
         - COALESCE(w.spend_ovr, l.paid, 0)                                 AS remaining,
       -- Forecast = manual (si existe) o Spend + timeline futuro (>= cutoff)
       COALESCE(w.forecast_total,
                COALESCE(w.spend_ovr, l.paid, 0) + COALESCE(tlf.future, 0)) AS forecast,
       COALESCE(w.forecast_total,
                COALESCE(w.spend_ovr, l.paid, 0) + COALESCE(tlf.future, 0))
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
  SELECT SUM(amount_paid_usd) AS paid FROM ledger_entry WHERE wbs_id=w.id) l ON true
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
    bind = op.get_bind()
    bind.exec_driver_sql(_SEED)
    bind.exec_driver_sql(_VIEW)


def downgrade() -> None:
    pass
