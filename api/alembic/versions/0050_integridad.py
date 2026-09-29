"""Vista de verificación de integridad — v_data_integrity.

Cada fila es un chequeo con su conteo de fallas y el monto involucrado. Son las
comprobaciones que veníamos haciendo a mano y que costaron encontrar: el hueco
entre lo que el LEDGER dice pagado y lo que el cronograma tiene pintado, las
celdas fuera del horizonte (que hacían aparecer un faltante de 9.38M que no
existía), los pagos sin fecha que bloquean el historial.

Es una vista, no una tabla: se calcula al consultarla, así que nunca queda vieja.
Sólo lectura, sin efectos.

Convención: `severity` = 'error' cuando el número que se reporta está mal, y
'warning' cuando hay algo que atender pero las cifras cierran.

Revision ID: 0050_integridad
Revises: 0049_audit_captura
Create Date: 2026-09-29
"""

from __future__ import annotations

from alembic import op

revision = "0050_integridad"
down_revision = "0049_audit_captura"
branch_labels = None
depends_on = None

_VISTA = """
CREATE OR REPLACE VIEW v_data_integrity AS
WITH cfg AS (SELECT cutoff_date, horizon_start, horizon_end FROM settings LIMIT 1),
lineas AS (
  SELECT w.id, w.wbs_code,
         COALESCE(f.budget_revised, 0)                                     AS presupuesto,
         COALESCE(f.spend, 0)                                              AS gastado,
         COALESCE(f.forecast, 0)                                           AS pronostico,
         COALESCE(f.over_under, 0)                                         AS sobre_bajo,
         COALESCE((SELECT SUM(s.planned_amount) FROM schedule_cell s
                    WHERE s.wbs_id = w.id
                      AND s.week_start < (SELECT cutoff_date FROM cfg)), 0) AS pintado_pasado,
         COALESCE((SELECT SUM(s.planned_amount) FROM schedule_cell s
                    WHERE s.wbs_id = w.id), 0)                              AS pintado_total
  FROM wbs_item w
  LEFT JOIN v_wbs_financials f ON f.wbs_code = w.wbs_code
  WHERE w.is_active AND w.kind = 'cost'
),

-- 1. El cronograma no refleja lo que el LEDGER dice pagado (la columna Control).
chequeos AS (
SELECT 'control'::text AS check_code,
       'Ledger spend not reflected in the schedule'::text AS check_name,
       'Schedule'::text AS area, 'error'::text AS severity,
       count(*)::bigint AS failures,
       COALESCE(SUM(ABS(gastado - pintado_pasado)), 0)::numeric(16,2) AS amount,
       'Paint the missing amount in a week before the cut-off, or run "Bring history from the LEDGER".'::text AS hint
FROM lineas WHERE ABS(gastado - pintado_pasado) > 0.005

UNION ALL
-- 2. Pronóstico sin repartir en el calendario.
SELECT 'forecast_unspread', 'Forecast not fully spread over the timeline', 'Schedule', 'warning',
       count(*), COALESCE(SUM(ABS(pronostico - pintado_total)), 0)::numeric(16,2),
       'Distribute the balance into future weeks, or lower the Forecast.'
FROM lineas WHERE ABS(pronostico - pintado_total) > 0.005

UNION ALL
-- 3. Celdas fuera del horizonte: existen pero la pantalla no las dibuja ni las suma.
SELECT 'cells_outside_horizon', 'Schedule cells outside the planning horizon', 'Schedule', 'error',
       count(*), COALESCE(SUM(s.planned_amount), 0)::numeric(16,2),
       'Widen the horizon in settings; the amounts exist but no screen shows them.'
FROM schedule_cell s, cfg
WHERE s.week_start < cfg.horizon_start OR s.week_start > cfg.horizon_end

UNION ALL
-- 4. La base exige lunes; si algo entró por otra vía, se ve acá.
SELECT 'cells_not_monday', 'Schedule cells not starting on a Monday', 'Schedule', 'error',
       count(*), 0::numeric(16,2),
       'Every week must start on a Monday.'
FROM schedule_cell WHERE EXTRACT(isodow FROM week_start) <> 1

UNION ALL
-- 5. Amount Due desactualizado respecto de Amount − Amount Paid.
SELECT 'ledger_due_stale', 'Ledger rows where Amount Due does not match', 'Ledger', 'error',
       count(*), COALESCE(SUM(ABS(COALESCE(amount_due,0)
                    - (COALESCE(amount,0) - COALESCE(amount_paid,0)))), 0)::numeric(16,2),
       'Re-enter the Amount Paid on those rows so the variance is recomputed.'
FROM ledger_sheet_row WHERE kind = 'data'
  AND COALESCE(amount_due,0) IS DISTINCT FROM (COALESCE(amount,0) - COALESCE(amount_paid,0))

UNION ALL
-- 6. Gasto que no llega a ningún proyecto.
SELECT 'ledger_no_cost_code', 'Ledger payments with no Cost Code', 'Ledger', 'error',
       count(*), COALESCE(SUM(amount_paid), 0)::numeric(16,2),
       'Without a Cost Code the payment reaches no WBS line and is missing from the Job Cost.'
FROM ledger_sheet_row WHERE kind = 'data' AND COALESCE(amount_paid,0) <> 0
  AND NULLIF(TRIM(COALESCE(cost_code,'')),'') IS NULL

UNION ALL
-- 7. Cost Code que no corresponde a ninguna línea viva.
SELECT 'ledger_orphan_cost_code', 'Ledger rows pointing to a non-existent WBS line', 'Ledger', 'error',
       count(*), COALESCE(SUM(l.amount_paid), 0)::numeric(16,2),
       'The Cost Code does not match any active WBS line.'
FROM ledger_sheet_row l WHERE l.kind = 'data'
  AND NULLIF(TRIM(COALESCE(l.cost_code,'')),'') IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM wbs_item w WHERE w.wbs_code = l.cost_code AND w.is_active)

UNION ALL
-- 8. Pagos sin fecha usable: bloquean traer el historial al cronograma.
SELECT 'ledger_no_date', 'Ledger payments with no usable date', 'Ledger', 'warning',
       count(*), COALESCE(SUM(amount_paid), 0)::numeric(16,2),
       'Their week cannot be determined, so they stay out of the schedule history.'
FROM ledger_sheet_row WHERE kind = 'data' AND COALESCE(amount_paid,0) <> 0
  AND TRIM(COALESCE(entry_date,'')) !~ '^\\d{4}-\\d{2}-\\d{2}$'

UNION ALL
-- 9. Forecast por encima del presupuesto aprobado.
SELECT 'over_budget', 'Lines forecast above their approved budget', 'Budget', 'warning',
       count(*), COALESCE(SUM(sobre_bajo), 0)::numeric(16,2),
       'Either approve the change or cut the forecast.'
FROM lineas WHERE sobre_bajo > 1

UNION ALL
-- 10. Ya gastado por encima del presupuesto.
SELECT 'overdrawn', 'Lines already spent above their budget', 'Budget', 'error',
       count(*), COALESCE(SUM(gastado - presupuesto), 0)::numeric(16,2),
       'The money is already out; this needs a budget change, not a forecast cut.'
FROM lineas WHERE gastado - presupuesto > 1

UNION ALL
-- 11. Facturas recibidas que no cuelgan de ninguna fila del LEDGER.
SELECT 'receipts_unlinked', 'Invoice receipts not linked to the Ledger', 'Invoices', 'warning',
       count(*), 0::numeric(16,2),
       'Mixed currencies, so no total is given. Review them in Invoice Receipts.'
FROM invoice_receipt r
WHERE r.status <> 'ignored'
  AND NOT EXISTS (SELECT 1 FROM invoice_receipt_link k WHERE k.receipt_id = r.id)

UNION ALL
-- 12. Huecos en la numeración de desembolsos.
SELECT 'disbursement_gaps', 'Gaps in the disbursement numbering', 'Disbursements', 'warning',
       count(*), 0::numeric(16,2),
       'A draw number is missing from the sequence.'
FROM v_disbursement_gaps

UNION ALL
-- 13. Wires con diferencia sin explicar.
SELECT 'wires_unexplained', 'Wires with an unexplained difference', 'Disbursements', 'warning',
       count(*), COALESCE(SUM(ABS(sin_explicar)), 0)::numeric(16,2),
       'Amount received does not match amount sent net of bank fees.'
FROM v_wire_reconciliation WHERE ABS(COALESCE(sin_explicar,0)) > 1
)
-- `sort_order` no se publica en el reporte: solo fija el orden (errores primero,
-- y dentro de cada nivel lo que mas falla). Sin el, un SELECT * sobre un UNION
-- ALL no garantiza ningun orden.
SELECT c.*,
       (CASE WHEN c.severity = 'error' THEN 1 ELSE 2 END * 1000000
        - LEAST(c.failures, 999999))::int AS sort_order
FROM chequeos c;
"""


def upgrade() -> None:
    op.execute(_VISTA)


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS v_data_integrity;")
