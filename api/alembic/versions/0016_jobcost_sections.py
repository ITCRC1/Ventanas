"""Job Cost: fechas Start/Due (+ Duration DAYS360) y 2ª columna Draw # por línea.

Agrega `start_date` y `due_date` a `wbs_item` (editables como los overrides del
Job Cost) y recrea `v_wbs_financials` **añadiendo columnas al final** (no altera
las existentes, así la vista dependiente `v_timeline_detail` no se rompe):

  * start_date / due_date   — fechas de la línea (NULL si no se han cargado).
  * duration_days           — DAYS360(start, due) método US/NASD, como el Excel.
  * draw_no_first           — primer draw en el que aparece la línea (MIN disb_no);
                              complementa `draw_no` (último draw = MAX disb_no).

Nota: hoy `disbursement_line.wbs_id` no está poblado, por lo que draw_no y
draw_no_first quedan en NULL hasta que se liguen las líneas a los desembolsos.
No se inventan datos: la columna queda vacía mientras no exista el vínculo.

Revision ID: 0016_jobcost_sections
Revises: 0015_spend_from_ledger
Create Date: 2026-07-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0016_jobcost_sections"
down_revision = "0015_spend_from_ledger"
branch_labels = None
depends_on = None

# DAYS360 método US (NASD), replica de Excel:
#   d1_adj = 30 si d1 == 31, si no d1
#   d2_adj = 30 si d2 == 31 y d1_adj == 30 (o sea d1 en {30,31}), si no d2
#   dur    = (y2-y1)*360 + (m2-m1)*30 + (d2_adj - d1_adj)
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
       d.draw_no                                                            AS draw_no,
       -- Columnas nuevas (al final para no romper vistas dependientes)
       w.start_date                                                         AS start_date,
       w.due_date                                                           AS due_date,
       CASE
         WHEN w.start_date IS NULL OR w.due_date IS NULL THEN NULL
         ELSE (
           (date_part('year',  w.due_date) - date_part('year',  w.start_date)) * 360
         + (date_part('month', w.due_date) - date_part('month', w.start_date)) * 30
         + ((CASE WHEN date_part('day', w.due_date) = 31
                       AND date_part('day', w.start_date) >= 30 THEN 30
                  ELSE date_part('day', w.due_date) END)
            - (CASE WHEN date_part('day', w.start_date) = 31 THEN 30
                    ELSE date_part('day', w.start_date) END))
         )::int
       END                                                                  AS duration_days,
       d.draw_no_first                                                      AS draw_no_first
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
  SELECT MAX(di.disb_no) AS draw_no, MIN(di.disb_no) AS draw_no_first
  FROM disbursement_line dl JOIN disbursement di ON di.id = dl.disbursement_id
  WHERE dl.wbs_id = w.id) d ON true
WHERE w.is_active;
"""


def upgrade() -> None:
    op.add_column("wbs_item", sa.Column("start_date", sa.Date(), nullable=True))
    op.add_column("wbs_item", sa.Column("due_date", sa.Date(), nullable=True))
    op.get_bind().exec_driver_sql(_VIEW)


# Vista previa (0015) sin las columnas nuevas — para poder soltar las columnas
# en el downgrade sin que la dependencia lo impida.
_VIEW_0015 = """
CREATE OR REPLACE VIEW v_wbs_financials AS
SELECT w.id, w.wbs_code, w.title, w.owner, w.kind,
       ts.code AS state, c.name AS category, p.name AS phase,
       COALESCE(w.budget_original_ovr, b.original, 0)                       AS budget_original,
       COALESCE(w.budget_change_ovr,   b.changes,  0)                       AS budget_change,
       COALESCE(w.budget_original_ovr, b.original, 0)
         + COALESCE(w.budget_change_ovr, b.changes, 0)                      AS budget_revised,
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


# Árbol completo de vistas que dependen (transitivamente) de v_wbs_financials,
# con profundidad para recrearlas en orden topológico (dependencias primero).
_DEP_TREE = """
WITH RECURSIVE tree AS (
  SELECT 'v_wbs_financials'::regclass AS oid, 0 AS depth
  UNION ALL
  SELECT DISTINCT dv.oid, t.depth + 1
  FROM tree t
  JOIN pg_depend d ON d.refobjid = t.oid
  JOIN pg_rewrite r ON r.oid = d.objid
  JOIN pg_class dv ON dv.oid = r.ev_class AND dv.relkind = 'v'
  WHERE dv.oid <> t.oid
)
SELECT dv.relname, max(t.depth) AS depth, pg_get_viewdef(dv.oid, true) AS def
FROM tree t JOIN pg_class dv ON dv.oid = t.oid
WHERE t.depth > 0
GROUP BY dv.relname, dv.oid
ORDER BY depth;
"""


def downgrade() -> None:
    # No se puede CREATE OR REPLACE quitando columnas ni soltar las columnas de
    # wbs_item mientras la vista (y su árbol de dependientes) las referencian.
    # Capturamos todo el árbol, lo tiramos en cascada, recreamos la vista 0015 y
    # reconstruimos las dependientes en orden topológico; luego soltamos columnas.
    bind = op.get_bind()
    deps = list(bind.exec_driver_sql(_DEP_TREE).all())  # (relname, depth, def) por profundidad
    bind.exec_driver_sql("DROP VIEW IF EXISTS v_wbs_financials CASCADE")
    bind.exec_driver_sql(_VIEW_0015)
    for name, _depth, definition in deps:
        bind.exec_driver_sql(f"CREATE VIEW {name} AS {definition}")
    op.drop_column("wbs_item", "due_date")
    op.drop_column("wbs_item", "start_date")
