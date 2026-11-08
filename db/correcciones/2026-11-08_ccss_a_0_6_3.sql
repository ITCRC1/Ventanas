-- ============================================================================
-- CCSS mal codificado -> 0.6.3 CCSS Employee Benefits
-- 2026-11-08
-- ============================================================================
--
-- QUE PASO
--   La linea 0.6.3 "CCSS Employee Benefits" empezo a usarse en NOVIEMBRE 2026.
--   Antes de eso los pagos de CCSS ($800/mes) se codificaron a 0.4 (Admin Fee)
--   y a 0.6.1 (Farm Manager). No fue un error de digitacion: fue un cambio de
--   criterio aplicado hacia adelante y nunca hacia atras.
--
--   Son 21 filas, todas de $800, de enero 2025 a octubre 2026:
--     0.4    14 filas   $11,200
--     0.6.1   7 filas    $5,600
--                      ---------
--                       $16,800
--
-- POR QUE IMPORTA
--   0.6.3 muestra gasto $0 mientras $16,800 de CCSS viven en dos lineas que no
--   son suyas. Cualquier pregunta del tipo "cuanto llevamos pagado de seguro
--   social" da mal. Y la propuesta de presupuesto lee el remanente por linea:
--   0.4 y 0.6.1 parecen tener mas disponible del que tienen.
--
-- QUE HACE ESTE SCRIPT
--   Solo lo primero de tres pasos: mover el COST CODE de esas 21 filas.
--   Mueve tambien `account`, porque la pantalla guarda los dos juntos y dejar
--   el codigo 0.6.3 con el texto "Admin Fee..." seria peor que no tocar nada.
--
--   NO toca el cronograma ni los presupuestos. Eso va despues, a mano:
--     paso 2 -> Job Cost -> "⬅ Traer historial del LEDGER" (reescribe las
--               semanas anteriores al corte desde el ledger ya corregido)
--     paso 3 -> ajustar los tres presupuestos al nuevo cronograma:
--                 0.4     151,000.00 -> 139,800.00   (-11,200)
--                 0.6.1    45,984.00 ->  40,384.00   ( -5,600)
--                 0.6.3    11,200.00 ->  28,000.00   (+16,800)
--               El total del proyecto NO cambia: es una reclasificacion.
--
-- COMO SE CORRE
--   Tal como esta termina en ROLLBACK y no cambia nada: sirve para mirar el
--   antes y el despues. Para aplicarlo de verdad, cambiar la ultima linea a
--   COMMIT;
-- ============================================================================

BEGIN;

\echo ''
\echo '=== ANTES ==='
SELECT cost_code, count(*) AS filas, sum(amount_paid) AS pagado
  FROM ledger_sheet_row
 WHERE kind = 'data' AND description ILIKE '%CCSS%'
 GROUP BY cost_code ORDER BY cost_code;

SELECT wbs_code, budget_revised, spend, remaining
  FROM v_wbs_financials
 WHERE wbs_code IN ('0.4','0.6.1','0.6.3') ORDER BY wbs_code;

-- ---------------------------------------------------------------------------
-- El movimiento. Se acota a las filas que HOY estan en 0.4 o 0.6.1 para no
-- tocar las que ya estan bien, y asi el script se puede repetir sin dano.
-- ---------------------------------------------------------------------------
UPDATE ledger_sheet_row r
   SET cost_code = w.wbs_code,
       account   = w.title
  FROM wbs_item w
 WHERE w.wbs_code = '0.6.3'
   AND r.kind = 'data'
   AND r.description ILIKE '%CCSS%'
   AND r.cost_code IN ('0.4', '0.6.1');

\echo ''
\echo '=== DESPUES ==='
SELECT cost_code, count(*) AS filas, sum(amount_paid) AS pagado
  FROM ledger_sheet_row
 WHERE kind = 'data' AND description ILIKE '%CCSS%'
 GROUP BY cost_code ORDER BY cost_code;

SELECT wbs_code, budget_revised, spend, remaining
  FROM v_wbs_financials
 WHERE wbs_code IN ('0.4','0.6.1','0.6.3') ORDER BY wbs_code;

\echo ''
\echo '=== el total del proyecto no se mueve ==='
SELECT sum(budget_revised) AS revisado, sum(spend) AS gastado
  FROM v_wbs_financials
 WHERE kind NOT IN ('section_header','proceeds');

-- Cambiar a COMMIT; para aplicar.
ROLLBACK;
