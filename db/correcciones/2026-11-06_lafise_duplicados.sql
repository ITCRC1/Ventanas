-- =====================================================================
-- LAFISE operativa: 16 movimientos cargados dos veces
--
-- Que pasa hoy
--   La hoja Banks encadena saldo = anterior + credito - debito y llega a
--   -143,185.45. El banco, en su ultimo movimiento, dice 49,673.41.
--   La diferencia es 192,858.86 y se parte en dos:
--
--     156,499.42  16 debitos cargados dos veces   <- esto corrige este script
--      36,359.44  cinco meses que nunca se cargaron  <- esto NO lo arregla SQL
--     ----------
--     192,858.86
--
-- Como se sabe que son duplicados y no dos pagos iguales
--   Las dos filas traen el MISMO saldo del banco. Dos movimientos reales
--   dejan saldos distintos; dos filas con el mismo saldo son la misma
--   linea del estado de cuenta leida dos veces.
--
--   Ejemplo, 2025-06-12:
--     id 296  GASTOS DE MAYO 2025   debito 14,125.00   saldo 33,307.02
--     id 436  GASTOS DE MAYO 2025   debito 14,125.00   saldo 33,307.02
--
--   De donde salieron: la carga original va de 2025-05-05 a 2026-01-23
--   (ids < 436). Despues alguien corrio otra vez un pedazo del mismo
--   estado y entraron los ids 436-451, fechados 2025-06-12 a 2026-01-15.
--   Es una re-carga parcial que inserto en vez de reconocer lo que ya
--   estaba.
--
-- Antes de correrlo
--   * Ningun ledger_entry apunta a estas 16 filas (verificado 2026-11-06),
--     asi que borrarlas no deja nada colgando.
--   * Corre dentro de una transaccion y se verifica sola: si el saldo no
--     queda en 49,673.41 al centavo, aborta y no borra nada.
--
-- Lo que NO arregla
--   Los 36,359.44 restantes son los meses 2026-02, 03, 04, 05 y 08, que
--   no tienen un solo movimiento cargado, mas la cola de enero (el mes se
--   corta el dia 23). Eso se arregla cargando esos estados de cuenta, no
--   con SQL.
-- =====================================================================

BEGIN;

-- 1. Lo que se va a borrar, para que quede en el log antes de tocarlo.
SELECT t.id, t.tx_date, t.description, t.debit, t.credit, t.balance
FROM bank_tx t
JOIN bank_account a ON a.id = t.account_id
WHERE a.name = 'Ventanas LAFISE (operativa)'
  AND t.id BETWEEN 436 AND 451
ORDER BY t.id;

-- 2. Red de seguridad: que sean EXACTAMENTE 16 y que cada una tenga una
--    gemela anterior con la misma fecha, descripcion, monto y saldo.
DO $$
DECLARE n int; gemelas int;
BEGIN
  SELECT count(*) INTO n
  FROM bank_tx t JOIN bank_account a ON a.id = t.account_id
  WHERE a.name = 'Ventanas LAFISE (operativa)' AND t.id BETWEEN 436 AND 451;
  IF n <> 16 THEN
    RAISE EXCEPTION 'Se esperaban 16 filas en el rango 436-451 y hay %. Nada se borro.', n;
  END IF;

  SELECT count(*) INTO gemelas
  FROM bank_tx d
  WHERE d.id BETWEEN 436 AND 451
    AND EXISTS (
      SELECT 1 FROM bank_tx o
      WHERE o.account_id   = d.account_id
        AND o.tx_date      = d.tx_date
        AND o.description  = d.description
        AND o.debit        IS NOT DISTINCT FROM d.debit
        AND o.credit       IS NOT DISTINCT FROM d.credit
        AND o.balance      IS NOT DISTINCT FROM d.balance
        AND o.id < d.id);
  IF gemelas <> 16 THEN
    RAISE EXCEPTION 'Solo % de 16 tienen gemela exacta. Nada se borro.', gemelas;
  END IF;
END $$;

-- 3. Borrar.
DELETE FROM bank_tx
WHERE id BETWEEN 436 AND 451;

-- 4. Verificacion: el saldo encadenado tiene que quedar en 13,313.97, que
--    es lo que el detalle cargado explica. Lo que falta para llegar a los
--    49,673.41 del banco son los 36,359.44 de los meses sin cargar.
DO $$
DECLARE cadena numeric; banco numeric;
BEGIN
  SELECT SUM(COALESCE(t.credit,0) - COALESCE(t.debit,0)) INTO cadena
  FROM bank_tx t JOIN bank_account a ON a.id = t.account_id
  WHERE a.name = 'Ventanas LAFISE (operativa)';

  SELECT t.balance INTO banco
  FROM bank_tx t JOIN bank_account a ON a.id = t.account_id
  WHERE a.name = 'Ventanas LAFISE (operativa)'
  ORDER BY t.tx_date DESC, t.id DESC LIMIT 1;

  RAISE NOTICE 'cadena: %   banco: %   falta por cargar: %',
               ROUND(cadena,2), ROUND(banco,2), ROUND(banco - cadena,2);

  IF ROUND(cadena,2) <> 13313.97 THEN
    RAISE EXCEPTION 'La cadena quedo en % y se esperaba 13,313.97. Se revierte todo.',
                    ROUND(cadena,2);
  END IF;
END $$;

-- Si llegaste hasta aca sin excepcion, confirmalo vos:
--   COMMIT;
-- Para dejar todo como estaba:
--   ROLLBACK;
ROLLBACK;
