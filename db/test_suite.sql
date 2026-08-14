-- ============================================================================
-- DASHBOARD VENTANAS — Suite de validación
-- Ejercita cada constraint, trigger y vista contra datos reales.
-- ============================================================================
SET client_min_messages = warning;

CREATE TABLE IF NOT EXISTS test_result (
  id serial PRIMARY KEY, lente text, nombre text, esperado text, obtenido text, ok boolean
);
TRUNCATE test_result;

-- Helper: espera que un SQL FALLE
CREATE OR REPLACE FUNCTION expect_fail(p_lente text, p_name text, p_sql text) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    INSERT INTO test_result(lente,nombre,esperado,obtenido,ok)
      VALUES (p_lente,p_name,'rechazo','ACEPTADO',false);
  EXCEPTION WHEN others THEN
    INSERT INTO test_result(lente,nombre,esperado,obtenido,ok)
      VALUES (p_lente,p_name,'rechazo','rechazado: '||left(SQLERRM,60),true);
  END;
END $$ LANGUAGE plpgsql;

-- Helper: espera que un SQL PASE
CREATE OR REPLACE FUNCTION expect_ok(p_lente text, p_name text, p_sql text) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
    INSERT INTO test_result(lente,nombre,esperado,obtenido,ok) VALUES (p_lente,p_name,'exito','ok',true);
  EXCEPTION WHEN others THEN
    INSERT INTO test_result(lente,nombre,esperado,obtenido,ok)
      VALUES (p_lente,p_name,'exito','FALLO: '||left(SQLERRM,70),false);
  END;
END $$ LANGUAGE plpgsql;

-- Helper: compara un valor
CREATE OR REPLACE FUNCTION expect_eq(p_lente text, p_name text, p_sql text, p_exp text) RETURNS void AS $$
DECLARE got text;
BEGIN
  EXECUTE p_sql INTO got;
  INSERT INTO test_result(lente,nombre,esperado,obtenido,ok)
    VALUES (p_lente,p_name,p_exp,COALESCE(got,'NULL'),COALESCE(got,'NULL')=p_exp);
EXCEPTION WHEN others THEN
  INSERT INTO test_result(lente,nombre,esperado,obtenido,ok)
    VALUES (p_lente,p_name,p_exp,'ERROR: '||left(SQLERRM,60),false);
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------- semilla
SET app.user_id = 'bismark';
INSERT INTO app_user (username,full_name,role_id)
  SELECT 'bismark','Financial Controller',id FROM role WHERE code='controller';
INSERT INTO app_user (username,full_name,role_id)
  SELECT 'corporate','Corporativo',id FROM role WHERE code='corporate';
INSERT INTO settings (company,manager,cutoff_date,horizon_start,horizon_end)
  VALUES ('SEED Development','Blake Delatte','2026-07-01','2026-01-05','2028-01-31');

INSERT INTO category (code,name,sort_order) VALUES
  ('Overhead','Overhead',1), ('Setena D1','Setena D1',2), ('Concessions','Concessions',3);
INSERT INTO phase (category_id,code,name) SELECT id,'P2','Overhead / Personnel' FROM category WHERE code='Overhead';
INSERT INTO phase (category_id,code,name) SELECT id,'PROPERTY','Property'          FROM category WHERE code='Overhead';
INSERT INTO phase (category_id,code,name) SELECT id,'ENGINEERING','Engineering'    FROM category WHERE code='Setena D1';

INSERT INTO wbs_item (wbs_code,title,category_id,phase_id,state_id,kind)
  SELECT '0.1','Development Team', c.id, p.id,
         (SELECT id FROM task_state WHERE code='approved'), 'cost'
  FROM category c JOIN phase p ON p.category_id=c.id AND p.code='P2' WHERE c.code='Overhead';
INSERT INTO wbs_item (wbs_code,title,category_id,phase_id,state_id,kind)
  SELECT '6','Property Sale', c.id, p.id,
         (SELECT id FROM task_state WHERE code='in_process'), 'proceeds'
  FROM category c JOIN phase p ON p.category_id=c.id AND p.code='PROPERTY' WHERE c.code='Overhead';
INSERT INTO wbs_item (wbs_code,title,category_id,phase_id,state_id)
  SELECT '3.2','Register Plans', c.id, p.id, (SELECT id FROM task_state WHERE code='attention')
  FROM category c JOIN phase p ON p.category_id=c.id AND p.code='ENGINEERING' WHERE c.code='Setena D1';

INSERT INTO budget_version (version_no,effective_date) VALUES (1,'2026-01-01'),(2,'2026-06-01');
INSERT INTO budget_line (wbs_id,version_id,amount)
  SELECT w.id,v.id,100000 FROM wbs_item w, budget_version v WHERE w.wbs_code='0.1' AND v.version_no=1;
INSERT INTO budget_line (wbs_id,version_id,amount)
  SELECT w.id,v.id,-480000 FROM wbs_item w, budget_version v WHERE w.wbs_code='6' AND v.version_no=1;

INSERT INTO bank_account (name,role,currency) VALUES
  ('Playa Ventanas II (Escrow)','escrow','USD'),
  ('Ventanas LAFISE (operativa)','operating','USD'),
  ('Ventanas LAFISE Colones','operating','CRC');
INSERT INTO payee (name,legal_id,bank_name,iban) VALUES
  ('SEED Dev. G','3-102-893339 S.R.L.','BCR','CR57015202001384709188'),
  ('Alta Batalla','3-102-XXXX','LAFISE','CR15011400007455394299');
INSERT INTO fx_rate (rate_date,from_currency,to_currency,rate,source)
  VALUES ('2026-06-30','CRC','USD',0.00196,'BCCR');

-- ============================ LENTE 3 · MODELO DE DATOS =====================
SELECT expect_fail('3-Datos','WBS duplicado (colisión del código 6)',
  $$INSERT INTO wbs_item (wbs_code,title) VALUES ('6','Encabezado duplicado')$$);

SELECT expect_fail('3-Datos','Fase que no pertenece a la categoría',
  $$INSERT INTO wbs_item (wbs_code,title,category_id,phase_id)
    SELECT 'X.1','Mal asignada',
      (SELECT id FROM category WHERE code='Concessions'),
      (SELECT id FROM phase WHERE code='ENGINEERING')$$);

SELECT expect_ok('3-Datos','Reasignar categoría limpia la fase inválida',
  $$UPDATE wbs_item SET category_id=(SELECT id FROM category WHERE code='Concessions')
    WHERE wbs_code='3.2'$$);
SELECT expect_eq('3-Datos','...y la fase queda NULL para reasignar',
  $$SELECT COALESCE(phase_id::text,'NULL') FROM wbs_item WHERE wbs_code='3.2'$$, 'NULL');
SELECT expect_eq('3-Datos','...y aparece en la bandeja de reasignación',
  $$SELECT count(*)::text FROM v_reassignment_queue WHERE wbs_code='3.2'$$, '1');

SELECT expect_fail('3-Datos','Semana que no es lunes',
  $$INSERT INTO schedule_cell (wbs_id,week_start,planned_amount,state_id)
    SELECT id,'2026-01-07',1000,(SELECT id FROM task_state WHERE code='approved')
    FROM wbs_item WHERE wbs_code='0.1'$$);

SELECT expect_fail('3-Datos','Estado que exige monto, sin monto',
  $$INSERT INTO schedule_cell (wbs_id,week_start,state_id)
    SELECT id,'2026-01-05',(SELECT id FROM task_state WHERE code='approved')
    FROM wbs_item WHERE wbs_code='0.1'$$);

SELECT expect_ok('3-Datos','Not Started sin monto SÍ se acepta',
  $$INSERT INTO schedule_cell (wbs_id,week_start,state_id)
    SELECT id,'2026-01-12',(SELECT id FROM task_state WHERE code='not_started')
    FROM wbs_item WHERE wbs_code='0.1'$$);

SELECT expect_ok('3-Datos','Celda válida con monto',
  $$INSERT INTO schedule_cell (wbs_id,week_start,planned_amount,state_id)
    SELECT id,'2026-01-05',14125,(SELECT id FROM task_state WHERE code='approved')
    FROM wbs_item WHERE wbs_code='0.1'$$);

-- Presupuesto congelado
UPDATE budget_version SET is_locked=true WHERE version_no=1;
SELECT expect_fail('3-Datos','Editar presupuesto de versión cerrada',
  $$UPDATE budget_line SET amount=999 WHERE version_id=(SELECT id FROM budget_version WHERE version_no=1)$$);
SELECT expect_ok('3-Datos','Cambio en versión abierta',
  $$INSERT INTO budget_line (wbs_id,version_id,amount)
    SELECT w.id,v.id,25000 FROM wbs_item w, budget_version v
    WHERE w.wbs_code='0.1' AND v.version_no=2$$);
SELECT expect_eq('3-Datos','Presupuesto revisado = original + cambios',
  $$SELECT budget_revised::text FROM v_wbs_financials WHERE wbs_code='0.1'$$, '125000.00');

-- ============================ MULTIMONEDA ==================================
SELECT expect_fail('3-Datos','USD con tasa distinta de 1',
  $$INSERT INTO ledger_entry (wbs_id,entry_date,currency,amount,fx_rate)
    SELECT id,'2026-06-30','USD',100,0.5 FROM wbs_item WHERE wbs_code='0.1'$$);
SELECT expect_ok('3-Datos','Gasto en colones con tasa',
  $$INSERT INTO ledger_entry (wbs_id,entry_date,description,currency,amount,fx_rate,amount_paid)
    SELECT id,'2026-06-30','Agua ASADA','CRC',18841.0,0.00196,18841.0
    FROM wbs_item WHERE wbs_code='0.1'$$);
SELECT expect_eq('3-Datos','...dolarizado correctamente',
  $$SELECT amount_usd::text FROM ledger_entry WHERE description='Agua ASADA'$$, '36.93');

SELECT expect_fail('3-Datos','Liberar un asiento sin razón',
  $$UPDATE ledger_entry SET status='released' WHERE description='Agua ASADA'$$);

-- ============================ LENTE 7 · DESEMBOLSOS =========================
SELECT expect_fail('7-Logica','Periodo que no es inicio de mes',
  $$INSERT INTO disbursement (disb_no,period_month) VALUES (99,'2026-06-15')$$);

SELECT expect_ok('7-Logica','Crear desembolso #24 (junio 2026)',
  $$INSERT INTO disbursement (disb_no,period_month,send_date) VALUES (24,'2026-06-01','2026-06-01')$$);

SELECT expect_fail('7-Logica','Sub-desembolso sin padre',
  $$INSERT INTO disbursement (disb_no,disb_sub,period_month) VALUES (24,1,'2026-06-01')$$);

SELECT expect_ok('7-Logica','Dos desembolsos en el mismo mes (caso raro pero válido)',
  $$INSERT INTO disbursement (disb_no,period_month) VALUES (25,'2026-06-01')$$);

-- Las 9 líneas reales del Breakdown de junio 2026
INSERT INTO disbursement_line (disbursement_id,line_no,description,amount,payee_id,category_id,phase_id,reason)
SELECT d.id, x.n, x.descr, x.amt,
       (SELECT id FROM payee WHERE name='SEED Dev. G'),
       (SELECT id FROM category WHERE code='Overhead'),
       (SELECT id FROM phase WHERE code='P2'), x.reason
FROM disbursement d, (VALUES
  (1,'Development Team - JUNE 2026',14125.00,'Management Fee'),
  (2,'Admin Fee + Financial Controller 25% - JUNE 2026',3750.00,'Employee Salary'),
  (3,'CCSS (Social Security) JUNE 2026',800.00,'Employee Salary'),
  (4,'Alexi Payment - Care Taker Ventanas',1824.71,'Employee Salary'),
  (5,'Expense Reimbursement - Alexis',329.38,'Employee Salary'),
  (6,'ALTA BATALLA: Setena Response Legal Advice',3926.75,'Corporations'),
  (7,'INVU Clearance: Fluvial P-44195-2024',91.29,'Permitting'),
  (8,'INVU Clearance: Fluvial P-2318513-2021',91.29,'Permitting'),
  (9,'Water Consumption April-May 2026 ASADA',36.93,'Maintenance')
) AS x(n,descr,amt,reason)
WHERE d.disb_no=24 AND d.disb_sub=0;

-- Las 9 líneas del Breakdown suman 24975.35, que es lo que dice la carta de
-- instrucción. El total impreso en el Breakdown (24975.36) es el equivocado.
SELECT expect_eq('7-Logica','Total = suma real de las 9 líneas del PDF',
  $$SELECT total_amount::text FROM disbursement WHERE disb_no=24$$, '24975.35');

-- ============================ CUENTA DE CRÉDITOS ============================
SELECT expect_eq('7-Logica','Saldo de crédito inicial en cero',
  $$SELECT disponible::text FROM v_credit_balance$$, '0.00');

-- Un pago que no se hizo genera crédito
INSERT INTO ledger_entry (wbs_id,entry_date,description,currency,amount,amount_paid,status,released_reason)
  SELECT id,'2026-05-15','Pago no ejecutado mayo','USD',7308.97,0,'released','Proveedor no facturó'
  FROM wbs_item WHERE wbs_code='0.1';
SELECT expect_eq('7-Logica','El asiento liberado genera crédito disponible',
  $$SELECT disponible::text FROM v_credit_balance$$, '7308.97');

SELECT expect_fail('7-Logica','Aplicar MÁS crédito del disponible',
  $$INSERT INTO credit_application (disbursement_id,amount)
    SELECT id, 10000 FROM disbursement WHERE disb_no=24$$);

SELECT expect_ok('7-Logica','Aplicar una PARTE del crédito',
  $$INSERT INTO credit_application (disbursement_id,amount,note)
    SELECT id, 3000, 'Aplicación parcial' FROM disbursement WHERE disb_no=24$$);

SELECT expect_eq('7-Logica','Total del desembolso baja por el crédito aplicado',
  $$SELECT total_amount::text FROM disbursement WHERE disb_no=24$$, '21975.35');
SELECT expect_eq('7-Logica','Saldo de crédito remanente',
  $$SELECT disponible::text FROM v_credit_balance$$, '4308.97');
SELECT expect_eq('7-Logica','Estado de cuenta con saldo corrido',
  $$SELECT count(*)::text FROM v_credit_ledger$$, '2');

-- ============================ BLOQUEO POR APROBACIÓN ========================
UPDATE disbursement SET status='approved', approved_at=now(),
       approved_by=(SELECT id FROM app_user WHERE username='corporate')
 WHERE disb_no=24;

SELECT expect_fail('7-Logica','Editar línea de desembolso ya aprobado',
  $$UPDATE disbursement_line SET amount=9999
    WHERE disbursement_id=(SELECT id FROM disbursement WHERE disb_no=24) AND line_no=1$$);
SELECT expect_fail('7-Logica','Agregar línea a desembolso aprobado',
  $$INSERT INTO disbursement_line (disbursement_id,line_no,description,amount)
    SELECT id,99,'Gasto tardío',500 FROM disbursement WHERE disb_no=24$$);

SELECT expect_ok('7-Logica','Emitir sub-desembolso #24.1 para lo que llegó tarde',
  $$INSERT INTO disbursement (disb_no,disb_sub,parent_id,period_month)
    SELECT 24,1,id,'2026-06-01' FROM disbursement WHERE disb_no=24 AND disb_sub=0$$);
SELECT expect_ok('7-Logica','...y sí acepta líneas',
  $$INSERT INTO disbursement_line (disbursement_id,line_no,description,amount)
    SELECT id,1,'Gasto tardío junio',500
    FROM disbursement WHERE disb_no=24 AND disb_sub=1$$);
SELECT expect_eq('7-Logica','El sub-desembolso no cuenta como hueco de numeración',
  $$SELECT count(*)::text FROM v_disbursement_gaps$$, '0');

-- Hueco real: falta el #17
INSERT INTO disbursement (disb_no,period_month)
  SELECT n, make_date(2024,1,1) FROM generate_series(1,23) n WHERE n <> 17;
SELECT expect_eq('7-Logica','Detecta el hueco del #17 y solo ese',
  $$SELECT string_agg(disb_no_faltante::text,',') FROM v_disbursement_gaps$$, '17');

-- ============================ TRAZABILIDAD =================================
INSERT INTO wire_transfer (disbursement_id,wire_date,to_account_id,amount_sent,amount_received,reference)
  SELECT d.id,'2026-06-08',b.id,21975.35,21975.35,'W-TRACE' FROM disbursement d, bank_account b
  WHERE d.disb_no=24 AND d.disb_sub=0 AND b.role='escrow';
INSERT INTO fund_movement (disbursement_id,move_date,from_account_id,to_account_id,amount)
  SELECT d.id,'2026-06-10',e.id,o.id,21975.35
  FROM disbursement d, bank_account e, bank_account o
  WHERE d.disb_no=24 AND d.disb_sub=0 AND e.role='escrow' AND o.name='Ventanas LAFISE (operativa)';

SELECT expect_fail('7-Logica','Traslado entre la misma cuenta',
  $$INSERT INTO fund_movement (move_date,from_account_id,to_account_id,amount)
    SELECT '2026-06-11',id,id,100 FROM bank_account WHERE role='escrow'$$);

-- ============================ LENTE 2 · AUDITORÍA ==========================
SELECT expect_eq('2-Seguridad','La auditoría registra el cambio de estado del desembolso',
  $$SELECT count(*)::text FROM audit_log WHERE table_name='disbursement' AND field='status'$$, '1');
SELECT expect_eq('2-Seguridad','...y guarda QUIÉN lo hizo',
  $$SELECT user_id FROM audit_log WHERE table_name='disbursement' AND field='status' LIMIT 1$$, 'bismark');
SELECT expect_eq('2-Seguridad','Auditoría de reasignación de categoría',
  $$SELECT count(*)::text FROM audit_log WHERE table_name='wbs_item' AND field='category_id'$$, '1');
SELECT expect_eq('2-Seguridad','Ningún registro de auditoría queda sin autor',
  $$SELECT count(*)::text FROM audit_log WHERE user_id IS NULL$$, '0');
SELECT expect_eq('2-Seguridad','Permisos separados: aprobar vs ver IBAN',
  $$SELECT count(*)::text FROM permission WHERE code IN ('disb.approve','bank.view')$$, '2');

-- ============================ LENTE 5 · COHERENCIA =========================
SELECT expect_eq('5-Coherencia','proceeds NO cuenta como costo en presupuesto vs actual',
  $$SELECT count(*)::text FROM v_budget_vs_actual WHERE wbs_code='6'$$, '0');
SELECT expect_eq('5-Coherencia','...pero sí existe en el maestro',
  $$SELECT kind FROM wbs_item WHERE wbs_code='6'$$, 'proceeds');
SELECT expect_eq('5-Coherencia','La leyenda tiene los 5 estados del master',
  $$SELECT count(*)::text FROM task_state$$, '5');
SELECT expect_eq('5-Coherencia','Timeline y Timeline Detail salen del mismo dato',
  $$SELECT (
     (SELECT COALESCE(SUM(planned),0) FROM v_timeline) =
     (SELECT COALESCE(SUM(planned_amount),0) FROM schedule_cell))::text$$, 'true');

-- ============================ LENTE 4 · EXTENSIBILIDAD =====================
SELECT expect_ok('4-Extensib','Agregar una categoría nueva sin tocar código',
  $$INSERT INTO category (code,name,sort_order) VALUES ('Construction','Construction',9)$$);
SELECT expect_ok('4-Extensib','Agregar un estado nuevo al catálogo',
  $$INSERT INTO task_state (code,label,color_hex,requires_amount,sort_order)
    VALUES ('on_hold','En espera','#FFA500',false,6)$$);
SELECT expect_ok('4-Extensib','Agregar un rol de usuario nuevo',
  $$INSERT INTO role (code,name) VALUES ('auditor','Auditor externo')$$);
SELECT expect_ok('4-Extensib','Extender el horizonte del cronograma',
  $$SELECT extend_horizon('2029-12-31')$$);
SELECT expect_eq('4-Extensib','...el horizonte quedó extendido',
  $$SELECT horizon_end::text FROM settings$$, '2029-12-31');


-- ============================ WIRES Y COMISIONES ===========================
INSERT INTO wire_transfer (disbursement_id,wire_date,to_account_id,amount_sent,amount_received,reference)
  SELECT d.id,'2024-12-17',b.id,100000.00,99970.00,'W-273725'
  FROM disbursement d, bank_account b WHERE d.disb_no=16 AND b.role='escrow';
INSERT INTO wire_fee (wire_id,fee_type,bank_name,amount)
  SELECT id,'intermediary','Citibank N.A.',30.00 FROM wire_transfer WHERE reference='W-273725';

SELECT expect_eq('Wires','Wire con comisión identificada: nada sin explicar',
  $$SELECT sin_explicar::text FROM v_wire_reconciliation WHERE reference='W-273725'$$,'0.00');
SELECT expect_eq('Wires','Comisión como porcentaje del enviado',
  $$SELECT pct_comision::text FROM v_wire_reconciliation WHERE reference='W-273725'$$,'0.0300');

SELECT expect_fail('Wires','Comisión mayor que la diferencia real',
  $$INSERT INTO wire_fee (wire_id,fee_type,amount)
    SELECT id,'other',500 FROM wire_transfer WHERE reference='W-273725'$$);
SELECT expect_fail('Wires','Recibido mayor que enviado',
  $$INSERT INTO wire_transfer (wire_date,to_account_id,amount_sent,amount_received)
    SELECT '2026-07-01',id,1000,1200 FROM bank_account WHERE role='escrow'$$);

-- desglose entre dos bancos
INSERT INTO wire_transfer (disbursement_id,wire_date,to_account_id,amount_sent,amount_received,reference)
  SELECT d.id,'2025-01-14',b.id,100000.00,99970.00,'W-292937'
  FROM disbursement d, bank_account b WHERE d.disb_no=18 AND b.role='escrow';
INSERT INTO wire_fee (wire_id,fee_type,bank_name,amount)
  SELECT id,'sending','SunWest',12.00 FROM wire_transfer WHERE reference='W-292937';
INSERT INTO wire_fee (wire_id,fee_type,bank_name,amount)
  SELECT id,'intermediary','Citibank N.A.',18.00 FROM wire_transfer WHERE reference='W-292937';
SELECT expect_eq('Wires','Comisión repartida entre dos bancos suma igual',
  $$SELECT sin_explicar::text FROM v_wire_reconciliation WHERE reference='W-292937'$$,'0.00');

-- atajo de absorción
INSERT INTO wire_transfer (disbursement_id,wire_date,to_account_id,amount_sent,amount_received,reference)
  SELECT d.id,'2026-06-08',b.id,25000.00,24975.35,'W-JUN2026'
  FROM disbursement d, bank_account b WHERE d.disb_no=24 AND d.disb_sub=0 AND b.role='escrow';
SELECT expect_eq('Wires','Atajo: absorber la diferencia sin desglosar',
  $$SELECT wire_absorb_difference((SELECT id FROM wire_transfer WHERE reference='W-JUN2026'))::text$$,'24.65');
SELECT expect_eq('Wires','...y queda marcada como estimada',
  $$SELECT is_estimated::text FROM wire_fee
    WHERE wire_id=(SELECT id FROM wire_transfer WHERE reference='W-JUN2026')$$,'true');

-- diferencia parcialmente explicada: NO bloquea, se marca
INSERT INTO wire_transfer (disbursement_id,wire_date,to_account_id,amount_sent,amount_received,reference)
  SELECT d.id,'2026-07-15',b.id,50000,49960,'W-PARCIAL'
  FROM disbursement d, bank_account b
  WHERE d.disb_no=24 AND d.disb_sub=1 AND b.role='escrow';
INSERT INTO wire_fee (wire_id,fee_type,amount)
  SELECT id,'sending',15 FROM wire_transfer WHERE reference='W-PARCIAL';
SELECT expect_eq('Wires','Diferencia parcial no bloquea, queda sin explicar',
  $$SELECT sin_explicar::text FROM v_wire_reconciliation WHERE reference='W-PARCIAL'$$,'25.00');
SELECT expect_eq('Wires','...y aparece en pendientes de conciliar',
  $$SELECT pendiente FROM v_wire_pending WHERE reference='W-PARCIAL'$$,'comisión sin identificar');

SELECT expect_eq('Wires','Analítica: total de comisiones por banco',
  $$SELECT SUM(total)::text FROM v_bank_fees$$,'99.65');
SELECT expect_eq('Wires','Analítica por año devuelve 3 años',
  $$SELECT count(*)::text FROM v_bank_fees_by_year$$,'3');
-- Los tres montos NO tienen por qué ser iguales, y ese es el punto:
-- corporativo puede enviar un monto redondo y los bancos cobran en el camino.
SELECT expect_eq('Wires','Trazabilidad: enviado >= solicitado',
  $$SELECT (enviado_por_corporativo >= solicitado)::text
    FROM v_disbursement_trace WHERE disb_no=24 AND disb_sub=0$$, 'true');
SELECT expect_eq('Wires','Neto recibido = enviado - comisiones',
  $$SELECT (w.amount_sent - COALESCE((SELECT SUM(amount) FROM wire_fee WHERE wire_id=w.id),0)
            = w.amount_received)::text
    FROM wire_transfer w WHERE w.reference='W-JUN2026'$$, 'true');
SELECT expect_eq('Wires','Trazabilidad separa enviado de neto recibido',
  $$SELECT (enviado_por_corporativo > neto_recibido_escrow)::text
    FROM v_disbursement_trace WHERE disb_no=24 AND disb_sub=0$$,'true');


-- ============================ MÓDULO BANCARIO ==============================
-- Cierra el hueco R8: la clasificación y los cargos por mes sólo se habían
-- verificado a mano contra el archivo de LAFISE.

INSERT INTO bank_account (name,role,iban,currency)
  VALUES ('LAFISE Ventanas test','operating','CR49011400007813265875','USD');

-- movimientos representativos del estado de cuenta real
INSERT INTO bank_tx (account_id,tx_date,txn_no,description,debit,credit,balance)
SELECT b.id, x.f::date, x.t, x.d, x.deb, x.cre, 0
FROM bank_account b, (VALUES
  ('2026-06-01','1','INTERESES                 ',NULL::numeric,2.44::numeric),
  ('2026-06-08','137026240','Comisión Tranferencias en Tiem',4.00,NULL),
  ('2026-06-08','137026240','ALIN FLUV PLANO P23185132021',93.73,NULL),
  ('2026-06-16','138041096','Comisión Tranferencias en Tiem',4.00,NULL),
  ('2026-06-16','138041096','DEVELOPMENT TEAM  JUNE  2026',14125.00,NULL),
  ('2026-06-28','26872','CARGO ADMINISTRATIVO',1.50,NULL),
  ('2026-06-15','9001','PV2 Deployment Jun 2026',NULL,24975.36),
  ('2026-06-20','9002','GASTOS VARIOS__',500.00,NULL)
) AS x(f,t,d,deb,cre)
WHERE b.name='LAFISE Ventanas test';

SELECT expect_eq('Bancos','Clasifica intereses automáticamente',
  $$SELECT class_code FROM bank_tx WHERE description LIKE 'INTERESES%' LIMIT 1$$,'interest');
SELECT expect_eq('Bancos','Clasifica comisión de transferencia',
  $$SELECT count(*)::text FROM bank_tx WHERE class_code='transfer_fee'$$,'2');
SELECT expect_eq('Bancos','Clasifica cargo administrativo',
  $$SELECT count(*)::text FROM bank_tx WHERE class_code='admin_charge'$$,'1');
SELECT expect_eq('Bancos','Clasifica fondeo desde escrow',
  $$SELECT count(*)::text FROM bank_tx WHERE class_code='escrow_funding'$$,'1');
SELECT expect_eq('Bancos','Lo no reconocido con débito cae en pago',
  $$SELECT class_code FROM bank_tx WHERE description='GASTOS VARIOS__'$$,'payment');

SELECT expect_eq('Bancos','Cargos del mes = 4+4+1.50',
  $$SELECT total_cargos::text FROM v_bank_charges_monthly
    WHERE cuenta='LAFISE Ventanas test' AND mes='2026-06-01'$$,'9.50');
SELECT expect_eq('Bancos','Intereses del mes',
  $$SELECT intereses::text FROM v_bank_charges_monthly
    WHERE cuenta='LAFISE Ventanas test' AND mes='2026-06-01'$$,'2.44');
SELECT expect_eq('Bancos','Neto del mes = intereses - cargos',
  $$SELECT neto::text FROM v_bank_charges_monthly
    WHERE cuenta='LAFISE Ventanas test' AND mes='2026-06-01'$$,'-7.06');

-- la comisión comparte número de confirmación con su transferencia
SELECT expect_eq('Bancos','Liga la comisión con el pago que la generó',
  $$SELECT pago_relacionado FROM v_transfer_fee_detail WHERE txn_no='138041096'$$,
  'DEVELOPMENT TEAM  JUNE  2026');
SELECT expect_eq('Bancos','Comisión plana pesa más en pagos chicos',
  $$SELECT (
     (SELECT pct_sobre_pago FROM v_transfer_fee_detail WHERE txn_no='137026240') >
     (SELECT pct_sobre_pago FROM v_transfer_fee_detail WHERE txn_no='138041096'))::text$$,'true');

-- reimportar el mismo movimiento no duplica
SELECT expect_fail('Bancos','Movimiento idéntico no se duplica',
  $$INSERT INTO bank_tx (account_id,tx_date,txn_no,description,debit,credit,balance)
    SELECT id,'2026-06-28','26872','CARGO ADMINISTRATIVO',1.50,NULL,0
    FROM bank_account WHERE name='LAFISE Ventanas test'$$);

-- recuperación de cargos PRORRATEADA (bug R2)
INSERT INTO bank_tx (account_id,tx_date,txn_no,description,debit,credit,balance)
SELECT b.id, x.f::date, x.t, 'CARGO ADMINISTRATIVO', x.deb, NULL, 0
FROM bank_account b, (VALUES ('2026-07-28','26873',4.50::numeric)) AS x(f,t,deb)
WHERE b.name='LAFISE Ventanas test';

INSERT INTO disbursement (disb_no,period_month) VALUES (40,'2026-08-01');
INSERT INTO disbursement_line (disbursement_id,line_no,description,amount)
  SELECT id,1,'Recuperación cargos jun-jul',7.00 FROM disbursement WHERE disb_no=40;
INSERT INTO charge_recovery (disbursement_line_id,account_id,period_from,period_to,amount)
  SELECT dl.id,b.id,'2026-06-01','2026-07-31',7.00
  FROM disbursement_line dl, bank_account b
  WHERE dl.description='Recuperación cargos jun-jul' AND b.name='LAFISE Ventanas test';

-- cargos: junio 9.50, julio 4.50, total 14.00. Se recuperan 7.00 -> prorrateo
-- junio = 7.00 * 9.50/14.00 = 4.75 ; julio = 7.00 * 4.50/14.00 = 2.25
SELECT expect_eq('Bancos','Recuperación prorrateada a junio',
  $$SELECT ROUND(aplicado,2)::text FROM v_charge_recovery_applied
    WHERE mes='2026-06-01' AND account_id=(SELECT id FROM bank_account WHERE name='LAFISE Ventanas test')$$,
  '4.75');
SELECT expect_eq('Bancos','Recuperación prorrateada a julio',
  $$SELECT ROUND(aplicado,2)::text FROM v_charge_recovery_applied
    WHERE mes='2026-07-01' AND account_id=(SELECT id FROM bank_account WHERE name='LAFISE Ventanas test')$$,
  '2.25');
SELECT expect_eq('Bancos','La suma prorrateada = lo recuperado, no el triple',
  $$SELECT ROUND(SUM(aplicado),2)::text FROM v_charge_recovery_applied$$,'7.00');
SELECT expect_eq('Bancos','Queda pendiente de recuperar en ambos meses',
  $$SELECT count(*)::text FROM v_charges_pending_recovery
    WHERE account_id=(SELECT id FROM bank_account WHERE name='LAFISE Ventanas test')$$,'2');

-- reglas de clasificación editables sin tocar código
SELECT expect_ok('Bancos','Agregar una regla nueva de clasificación',
  $$INSERT INTO bank_classification_rule (pattern,class_code,match_side,priority)
    VALUES ('GASTOS VARIOS','other','debit',15)$$);
-- Reclasificar = poner class_code en NULL; el trigger vuelve a evaluar reglas.
UPDATE bank_tx SET class_code=NULL WHERE description='GASTOS VARIOS__';
SELECT expect_eq('Bancos','...y reclasifica al poner class_code en NULL',
  $$SELECT class_code FROM bank_tx WHERE description='GASTOS VARIOS__'$$,'other');

-- ============================ RESULTADOS ===================================
\echo ''
\echo '================= RESULTADOS ================='
SELECT lente,
       count(*) FILTER (WHERE ok) AS pasan,
       count(*) FILTER (WHERE NOT ok) AS fallan
FROM test_result GROUP BY lente ORDER BY lente;
\echo ''
SELECT nombre, esperado, obtenido FROM test_result WHERE NOT ok;
\echo ''
SELECT count(*) AS total, count(*) FILTER (WHERE ok) AS pasan,
       count(*) FILTER (WHERE NOT ok) AS fallan FROM test_result;
