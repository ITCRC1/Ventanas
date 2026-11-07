-- =====================================================================
-- LAFISE operativa: sacar las 178 filas del ETL viejo ('excel-legacy')
--
-- Reemplaza a 2026-11-06_lafise_duplicados.sql, que borraba 16 filas. Esas
-- 16 son parte de estas 178; aquel script se quedaba corto.
--
-- QUE PASO
--   El 2026-11-07 se subio el estado de cuenta completo de LAFISE (ene-2025 a
--   nov-2026, 563 movimientos). Entraron 385 nuevos... y 176 de ellos eran
--   movimientos que YA estaban cargados por un ETL anterior.
--
--   No los freno la UNIQUE porque incluye txn_no, y las filas viejas traen un
--   numero inventado por ese ETL:
--
--     id 284  2025-05-15  ADMIN FEE BUDGET  FINANCIAL  6,150.00  saldo 8,014.30
--             txn_no = 'XLS-Bank Statement LAFISE-12'      <- inventado
--     id 724  2025-05-15  ADMIN FEE BUDGET FINANCIAL   6,150.00  saldo 8,014.30
--             txn_no = '94637733'                         <- el del banco
--
--   Mismo dia, mismo monto y MISMO SALDO: es el mismo movimiento. Dos
--   movimientos reales no pueden dejar el mismo saldo.
--
-- POR QUE SE VAN LAS VIEJAS Y NO LAS NUEVAS
--   Las nuevas vienen del estado de cuenta del banco: traen el numero de
--   confirmacion real y el texto sin mutilar. Las viejas traen un numero
--   inventado y descripciones con doble espacio. Ademas el estado completo es
--   autoconsistente: 563 filas, 0 donde el saldo no cuadre con su propio
--   debito/credito, y la cadena cierra en 48,209.76 al centavo.
--
-- LAS DOS QUE NO ESTAN EN EL ESTADO
--   id 401  2025-12-29  CARGO ADMINISTRATIVO   -1.50
--   id 402  2025-12-29  INTERESES              +2.47
--   Netean +0.97, que es exactamente lo que sobra si se dejan. El banco no las
--   reporta en su propio estado, asi que se van con el resto.
--
-- ALCANCE
--   SOLO la cuenta 'Ventanas LAFISE (operativa)'. El lote 'excel-legacy' tiene
--   451 filas en total, de las cuatro cuentas: las otras 273 NO se tocan.
--
-- SEGURIDAD
--   * Ningun ledger_entry apunta a estas filas (verificado 2026-11-07).
--   * Corre en transaccion y verifica sola: si la cadena no queda en 48,209.76
--     al centavo, aborta y no borra nada.
--   * Termina en ROLLBACK. El COMMIT lo escribis vos.
-- =====================================================================

BEGIN;

-- 1. Que se va, para que quede en el log.
SELECT t.id, t.tx_date, t.txn_no, t.description, t.debit, t.credit, t.balance
FROM bank_tx t JOIN bank_account a ON a.id = t.account_id
WHERE a.name = 'Ventanas LAFISE (operativa)' AND t.import_batch = 'excel-legacy'
ORDER BY t.tx_date, t.id;

-- 2. Red de seguridad.
DO $$
DECLARE n int; cubiertas int; refs int;
BEGIN
  SELECT count(*) INTO n
  FROM bank_tx t JOIN bank_account a ON a.id = t.account_id
  WHERE a.name = 'Ventanas LAFISE (operativa)' AND t.import_batch = 'excel-legacy';
  IF n <> 178 THEN
    RAISE EXCEPTION 'Se esperaban 178 filas legacy en LAFISE y hay %. Nada se borro.', n;
  END IF;

  SELECT count(*) INTO cubiertas
  FROM bank_tx v JOIN bank_account a ON a.id = v.account_id
  WHERE a.name = 'Ventanas LAFISE (operativa)' AND v.import_batch = 'excel-legacy'
    AND EXISTS (SELECT 1 FROM bank_tx x
                 WHERE x.account_id = v.account_id AND x.tx_date = v.tx_date
                   AND x.balance = v.balance
                   AND x.debit  IS NOT DISTINCT FROM v.debit
                   AND x.credit IS NOT DISTINCT FROM v.credit
                   AND x.import_batch <> 'excel-legacy');
  IF cubiertas <> 176 THEN
    RAISE EXCEPTION 'Se esperaban 176 cubiertas por el estado real y hay %. Nada se borro.', cubiertas;
  END IF;

  SELECT count(*) INTO refs FROM ledger_entry le
  WHERE le.bank_tx_id IN (
    SELECT t.id FROM bank_tx t JOIN bank_account a ON a.id = t.account_id
    WHERE a.name = 'Ventanas LAFISE (operativa)' AND t.import_batch = 'excel-legacy');
  IF refs <> 0 THEN
    RAISE EXCEPTION '% asientos del Ledger apuntan a estas filas. Nada se borro.', refs;
  END IF;
END $$;

-- 3. Borrar.
DELETE FROM bank_tx t
USING bank_account a
WHERE a.id = t.account_id
  AND a.name = 'Ventanas LAFISE (operativa)'
  AND t.import_batch = 'excel-legacy';

-- 4. Verificar: la cadena tiene que cerrar en el saldo que reporta el banco.
DO $$
DECLARE cadena numeric; banco numeric; quedan int;
BEGIN
  SELECT SUM(COALESCE(t.credit,0) - COALESCE(t.debit,0)), count(*) INTO cadena, quedan
  FROM bank_tx t JOIN bank_account a ON a.id = t.account_id
  WHERE a.name = 'Ventanas LAFISE (operativa)';

  SELECT t.balance INTO banco
  FROM bank_tx t JOIN bank_account a ON a.id = t.account_id
  WHERE a.name = 'Ventanas LAFISE (operativa)'
  ORDER BY t.tx_date DESC, t.id DESC LIMIT 1;

  RAISE NOTICE 'quedan % movimientos · cadena % · banco % · diferencia %',
               quedan, ROUND(cadena,2), ROUND(banco,2), ROUND(banco - cadena,2);

  IF ROUND(banco - cadena, 2) <> 0 THEN
    RAISE EXCEPTION 'La cadena no cierra: queda % de diferencia. Se revierte todo.',
                    ROUND(banco - cadena, 2);
  END IF;
END $$;

-- Si llegaste hasta aca sin excepcion, confirmalo vos:
--   COMMIT;
-- Para dejar todo como estaba:
--   ROLLBACK;
ROLLBACK;
