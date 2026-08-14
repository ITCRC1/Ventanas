"""Job Cost editable: overrides de Original/Changes/Spend por línea (como Excel).

El owner quiere editar las columnas del Job Cost directamente y que las derivadas
se muevan con fórmulas. Se agregan overrides manuales a wbs_item; la vista usa
COALESCE(override, calculado) y recalcula revised/remaining/over-under/forecast.

Revision ID: 0013_jobcost_editable
Revises: 0012_line_invoice_no
Create Date: 2026-07-25
"""

from __future__ import annotations

from alembic import op

revision = "0013_jobcost_editable"
down_revision = "0012_line_invoice_no"
branch_labels = None
depends_on = None

_COLS = (
    "ALTER TABLE wbs_item ADD COLUMN IF NOT EXISTS budget_original_ovr numeric(16,2);"
    "ALTER TABLE wbs_item ADD COLUMN IF NOT EXISTS budget_change_ovr   numeric(16,2);"
    "ALTER TABLE wbs_item ADD COLUMN IF NOT EXISTS spend_ovr           numeric(16,2);"
)

# Mismas columnas de salida (CREATE OR REPLACE), pero cada input usa el override
# manual si existe; las derivadas son fórmulas sobre esos valores.
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
       COALESCE(w.forecast_total,
                COALESCE(w.budget_original_ovr, b.original, 0)
                  + COALESCE(w.budget_change_ovr, b.changes, 0))            AS forecast,
       COALESCE(w.forecast_total,
                COALESCE(w.budget_original_ovr, b.original, 0)
                  + COALESCE(w.budget_change_ovr, b.changes, 0))
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
  SELECT MAX(di.disb_no) AS draw_no
  FROM disbursement_line dl JOIN disbursement di ON di.id = dl.disbursement_id
  WHERE dl.wbs_id = w.id) d ON true
WHERE w.is_active;
"""


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql(_COLS)
    bind.exec_driver_sql(_VIEW)


def downgrade() -> None:
    op.get_bind().exec_driver_sql(
        "ALTER TABLE wbs_item DROP COLUMN IF EXISTS budget_original_ovr, "
        "DROP COLUMN IF EXISTS budget_change_ovr, DROP COLUMN IF EXISTS spend_ovr"
    )
