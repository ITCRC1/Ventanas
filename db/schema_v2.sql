-- ============================================================================
-- DASHBOARD VENTANAS — Esquema PostgreSQL  ·  v2
-- Consolida schema.sql + schema_disbursements.sql y corrige los hallazgos
-- de la revisión por el método de 7 lentes.
--
-- Proyecto único (Ventanas). No multipropiedad.
-- El Job Cost Report es el regente: categoría y fase viven sólo en wbs_item.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Utilidades transversales
-- ---------------------------------------------------------------------------

-- updated_at automático en toda tabla editable
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$ LANGUAGE plpgsql;

-- Usuario de la sesión: la app hace SET LOCAL app.user_id = '<id>'
CREATE OR REPLACE FUNCTION current_app_user() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '');
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- 1. Usuarios y permisos            [corrige: no existía modelo de acceso]
-- ---------------------------------------------------------------------------
CREATE TABLE role (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permission (
  code        text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE role_permission (
  role_id     int  NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission  text NOT NULL REFERENCES permission(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE app_user (
  id          serial PRIMARY KEY,
  username    text NOT NULL UNIQUE,
  full_name   text NOT NULL,
  email       text UNIQUE,
  role_id     int  NOT NULL REFERENCES role(id),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app_user (role_id);
CREATE TRIGGER trg_touch_user BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
-- Nota: las credenciales NO viven aquí. Autenticación por proveedor externo
-- (OIDC/SSO) o tabla aparte con hash argon2 — nunca contraseñas en claro.

INSERT INTO role (code, name) VALUES
  ('controller','Financial Controller'),   -- Bismark: todo
  ('pm',        'Project Manager'),         -- Blake: presupuesto y cronograma
  ('corporate', 'Corporativo'),             -- aprueba desembolsos
  ('admin',     'Administración'),          -- captura de gastos y pagos
  ('viewer',    'Consulta');                -- lectura

INSERT INTO permission (code, description) VALUES
  ('wbs.edit',        'Crear y editar líneas WBS, reasignar categoría y fase'),
  ('budget.edit',     'Crear versiones de presupuesto'),
  ('schedule.edit',   'Editar el cronograma'),
  ('ledger.edit',     'Registrar pagos'),
  ('disb.create',     'Crear y editar desembolsos en borrador'),
  ('disb.submit',     'Enviar desembolso a corporativo'),
  ('disb.approve',    'Aprobar desembolso'),
  ('bank.view',       'Ver datos bancarios e IBAN de beneficiarios'),
  ('report.view',     'Ver reportes');

-- ---------------------------------------------------------------------------
-- 2. Parámetros y monedas
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  project_name   text NOT NULL DEFAULT 'Ventanas',
  company        text,
  manager        text,
  report_currency char(3) NOT NULL DEFAULT 'USD',   -- los reportes van dolarizados
  cutoff_date    date NOT NULL,
  cutoff_owner   int REFERENCES app_user(id),       -- quién mueve el corte
  horizon_start  date NOT NULL,
  horizon_end    date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_touch_settings BEFORE UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Tipo de cambio      [corrige: no había manejo de colones]
CREATE TABLE fx_rate (
  id            serial PRIMARY KEY,
  rate_date     date    NOT NULL,
  from_currency char(3) NOT NULL,
  to_currency   char(3) NOT NULL DEFAULT 'USD',
  rate          numeric(16,6) NOT NULL CHECK (rate > 0),
  source        text,                                -- BCCR, banco, manual
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rate_date, from_currency, to_currency)
);
CREATE INDEX ON fx_rate (from_currency, rate_date DESC);

-- ---------------------------------------------------------------------------
-- 3. Catálogos del proyecto
-- ---------------------------------------------------------------------------
CREATE TABLE category (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  color_hex   char(7),
  sort_order  int  NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_touch_category BEFORE UPDATE ON category
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE phase (
  id           serial PRIMARY KEY,
  category_id  int  NOT NULL REFERENCES category(id) ON DELETE CASCADE,
  code         text NOT NULL,
  name         text NOT NULL,
  sort_order   int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, code)
);
CREATE INDEX ON phase (category_id);
CREATE TRIGGER trg_touch_phase BEFORE UPDATE ON phase
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Estados: UNA sola forma de modelarlos     [corrige: ENUM vs tabla duplicados]
CREATE TABLE task_state (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  label           text NOT NULL,
  color_hex       char(7) NOT NULL,
  requires_amount boolean NOT NULL DEFAULT true,  -- ← reemplaza el número mágico
  is_committed    boolean NOT NULL DEFAULT false,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- Leyenda tomada del propio master (Job Cost Report, filas 129-133)
INSERT INTO task_state (code,label,color_hex,requires_amount,is_committed,sort_order) VALUES
 ('not_started','Not Started','#CCCCCC',false,false,1),
 ('in_process' ,'In process' ,'#FFFF00',true ,true ,2),
 ('approved'   ,'Approved'   ,'#1155CC',true ,true ,3),
 ('attention'  ,'Attention'  ,'#B85B22',true ,true ,4),
 ('completed'  ,'Completed'  ,'#38761D',true ,true ,5);

CREATE TABLE line_type (
  code text PRIMARY KEY, label text NOT NULL, counts_as_cost boolean NOT NULL
);
INSERT INTO line_type VALUES
 ('cost',          'Costo',              true),
 ('proceeds',      'Producto de venta',  false),   -- Property Sale −480.000
 ('section_header','Encabezado',         false);

-- ---------------------------------------------------------------------------
-- 4. WBS — el regente
-- ---------------------------------------------------------------------------
CREATE TABLE wbs_item (
  id            serial PRIMARY KEY,
  wbs_code      text NOT NULL UNIQUE,
  parent_id     int  REFERENCES wbs_item(id),
  title         text NOT NULL,
  owner         text,
  category_id   int  REFERENCES category(id),
  phase_id      int  REFERENCES phase(id),
  state_id      int  NOT NULL REFERENCES task_state(id) DEFAULT 1,
  kind          text NOT NULL REFERENCES line_type(code) DEFAULT 'cost',
  sort_order    int  NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON wbs_item (category_id);
CREATE INDEX ON wbs_item (phase_id);
CREATE INDEX ON wbs_item (parent_id);
CREATE INDEX ON wbs_item (state_id);
CREATE TRIGGER trg_touch_wbs BEFORE UPDATE ON wbs_item
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Un SOLO trigger: primero limpia la fase huérfana, después valida.
-- (Dos triggers BEFORE separados se disparaban en orden alfabético y el
--  validador rechazaba la reasignación antes de que el limpiador actuara.)
CREATE OR REPLACE FUNCTION wbs_enforce_category_phase() RETURNS trigger AS $$
BEGIN
  -- 1. Al cambiar de categoría, una fase que ya no aplica se descarta
  IF TG_OP = 'UPDATE' AND NEW.category_id IS DISTINCT FROM OLD.category_id
     AND NEW.phase_id IS NOT NULL THEN
    PERFORM 1 FROM phase WHERE id = NEW.phase_id AND category_id = NEW.category_id;
    IF NOT FOUND THEN NEW.phase_id := NULL; END IF;
  END IF;

  -- 2. Lo que quede tiene que ser coherente
  IF NEW.phase_id IS NOT NULL AND NEW.category_id IS NOT NULL THEN
    PERFORM 1 FROM phase WHERE id = NEW.phase_id AND category_id = NEW.category_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La fase % no pertenece a la categoría %', NEW.phase_id, NEW.category_id;
    END IF;
  END IF;

  -- 3. Una fase sin categoría no tiene sentido
  IF NEW.phase_id IS NOT NULL AND NEW.category_id IS NULL THEN
    RAISE EXCEPTION 'No se puede asignar fase sin categoría (WBS %)', NEW.wbs_code;
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_wbs_category_phase BEFORE INSERT OR UPDATE ON wbs_item
  FOR EACH ROW EXECUTE FUNCTION wbs_enforce_category_phase();

-- ---------------------------------------------------------------------------
-- 5. Presupuesto versionado
-- ---------------------------------------------------------------------------
CREATE TABLE budget_version (
  id             serial PRIMARY KEY,
  version_no     int  NOT NULL UNIQUE,
  effective_date date NOT NULL,
  approved_by    int  REFERENCES app_user(id),
  is_locked      boolean NOT NULL DEFAULT false,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE budget_line (
  id          bigserial PRIMARY KEY,
  wbs_id      int NOT NULL REFERENCES wbs_item(id) ON DELETE CASCADE,
  version_id  int NOT NULL REFERENCES budget_version(id),
  amount      numeric(16,2) NOT NULL,     -- puede ser negativo: proceeds/créditos
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wbs_id, version_id)
);
CREATE INDEX ON budget_line (wbs_id);
CREATE INDEX ON budget_line (version_id);
CREATE TRIGGER trg_touch_budgetline BEFORE UPDATE ON budget_line
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_budgetver BEFORE UPDATE ON budget_version
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Una versión cerrada queda congelada     [auditoría: dato que no se recalcula]
CREATE OR REPLACE FUNCTION budget_version_locked() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM budget_version v
             WHERE v.id = COALESCE(NEW.version_id, OLD.version_id) AND v.is_locked) THEN
    RAISE EXCEPTION 'La versión de presupuesto está cerrada — cree una versión nueva';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_budget_locked BEFORE INSERT OR UPDATE OR DELETE ON budget_line
  FOR EACH ROW EXECUTE FUNCTION budget_version_locked();

-- ---------------------------------------------------------------------------
-- 6. Cronograma
-- ---------------------------------------------------------------------------
CREATE TABLE schedule_cell (
  id              bigserial PRIMARY KEY,
  wbs_id          int  NOT NULL REFERENCES wbs_item(id) ON DELETE CASCADE,
  week_start      date NOT NULL,
  planned_amount  numeric(16,2),
  state_id        int  NOT NULL REFERENCES task_state(id),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (wbs_id, week_start),
  CONSTRAINT week_is_monday CHECK (EXTRACT(isodow FROM week_start) = 1)
);
CREATE INDEX ON schedule_cell (week_start);
CREATE INDEX ON schedule_cell (wbs_id);
CREATE INDEX ON schedule_cell (state_id);
CREATE TRIGGER trg_touch_cell BEFORE UPDATE ON schedule_cell
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- La incongruencia que las macros detectaban ya no puede existir.
-- Sin números mágicos: la regla vive en task_state.requires_amount.
CREATE OR REPLACE FUNCTION cell_amount_matches_state() RETURNS trigger AS $$
DECLARE req boolean;
BEGIN
  SELECT requires_amount INTO req FROM task_state WHERE id = NEW.state_id;
  IF req AND NEW.planned_amount IS NULL THEN
    RAISE EXCEPTION 'El estado exige monto planificado (WBS %, semana %)',
      NEW.wbs_id, NEW.week_start;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cell_state BEFORE INSERT OR UPDATE ON schedule_cell
  FOR EACH ROW EXECUTE FUNCTION cell_amount_matches_state();

-- El horizonte se extiende solo: nadie tiene que insertar semanas a mano
CREATE OR REPLACE FUNCTION extend_horizon(p_until date) RETURNS int AS $$
DECLARE n int;
BEGIN
  UPDATE settings SET horizon_end = GREATEST(horizon_end, p_until);
  SELECT count(*) INTO n FROM generate_series(
    (SELECT horizon_start FROM settings), p_until, interval '7 day');
  RETURN n;
END $$ LANGUAGE plpgsql;
-- Las celdas se materializan sólo cuando tienen dato; el rango de semanas
-- para pintar la grilla sale de settings, no de filas precreadas.

-- ---------------------------------------------------------------------------
-- 7. Contrapartes y recurrentes
-- ---------------------------------------------------------------------------
CREATE TABLE payee (
  id             serial PRIMARY KEY,
  name           text NOT NULL UNIQUE,
  legal_id       text,
  bank_name      text,
  iban           text,
  currency       char(3) NOT NULL DEFAULT 'USD',
  is_international boolean NOT NULL DEFAULT false,
  default_category_id int REFERENCES category(id),
  default_phase_id    int REFERENCES phase(id),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON payee (default_category_id);
CREATE INDEX ON payee (default_phase_id);
CREATE TRIGGER trg_touch_payee BEFORE UPDATE ON payee
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE recurring_item (
  id             serial PRIMARY KEY,
  label          text NOT NULL,
  payee_id       int  NOT NULL REFERENCES payee(id),
  wbs_id         int  REFERENCES wbs_item(id),
  reason         text,
  default_amount numeric(16,2),
  currency       char(3) NOT NULL DEFAULT 'USD',
  active_from    date NOT NULL,
  active_to      date,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recurring_dates CHECK (active_to IS NULL OR active_to >= active_from)
);
CREATE INDEX ON recurring_item (payee_id);
CREATE INDEX ON recurring_item (wbs_id);
CREATE TRIGGER trg_touch_recurring BEFORE UPDATE ON recurring_item
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------
-- 8. Desembolsos
-- ---------------------------------------------------------------------------
CREATE TABLE disb_status (
  code text PRIMARY KEY, label text NOT NULL,
  is_locked boolean NOT NULL DEFAULT false, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO disb_status VALUES
 ('draft',      'Borrador',              false,1),
 ('submitted',  'Enviado a corporativo', false,2),
 ('approved',   'Aprobado',              true ,3),
 ('funded',     'Wire recibido',         true ,4),
 ('transferred','Trasladado a LAFISE',   true ,5),
 ('settled',    'Liquidado',             true ,6),
 ('cancelled',  'Anulado',               true ,7);

CREATE TABLE disbursement (
  id              serial PRIMARY KEY,
  disb_no         int  NOT NULL CHECK (disb_no > 0),
  disb_sub        int  NOT NULL DEFAULT 0 CHECK (disb_sub >= 0),  -- #24, #24.1
  parent_id       int  REFERENCES disbursement(id),
  period_month    date NOT NULL,          -- SIN unique: puede haber 2 en un mes
  send_date       date,
  status          text NOT NULL REFERENCES disb_status(code) DEFAULT 'draft',
  credit_applied  numeric(16,2) NOT NULL DEFAULT 0,   -- derivado de credit_application
  total_amount    numeric(16,2) NOT NULL DEFAULT 0,
  submitted_at    timestamptz,
  submitted_by    int REFERENCES app_user(id),
  approved_at     timestamptz,
  approved_by     int REFERENCES app_user(id),
  breakdown_pdf   bytea,
  instruction_pdf bytea,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (disb_no, disb_sub),
  CONSTRAINT sub_needs_parent CHECK ((disb_sub = 0) = (parent_id IS NULL)),
  CONSTRAINT period_is_month_start CHECK (EXTRACT(day FROM period_month) = 1)
);
CREATE INDEX ON disbursement (period_month);
CREATE INDEX ON disbursement (status);
CREATE INDEX ON disbursement (parent_id);
CREATE TRIGGER trg_touch_disb BEFORE UPDATE ON disbursement
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE disbursement_line (
  id              bigserial PRIMARY KEY,
  disbursement_id int  NOT NULL REFERENCES disbursement(id) ON DELETE CASCADE,
  line_no         int  NOT NULL,
  description     text NOT NULL,
  amount          numeric(16,2) NOT NULL,   -- el crédito NO va aquí: ver credit_application
  currency        char(3) NOT NULL DEFAULT 'USD',
  wbs_id          int  REFERENCES wbs_item(id),
  category_id     int  REFERENCES category(id),
  phase_id        int  REFERENCES phase(id),
  reason          text,
  payee_id        int  REFERENCES payee(id),
  recurring_id    int  REFERENCES recurring_item(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (disbursement_id, line_no)
);
CREATE INDEX ON disbursement_line (disbursement_id);
CREATE INDEX ON disbursement_line (wbs_id);
CREATE INDEX ON disbursement_line (category_id);
CREATE INDEX ON disbursement_line (phase_id);
CREATE INDEX ON disbursement_line (payee_id);
CREATE INDEX ON disbursement_line (recurring_id);
CREATE TRIGGER trg_touch_disb_line BEFORE UPDATE ON disbursement_line
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Total = suma de líneas − crédito aplicado. Imposible el descuadre de un
-- centavo entre el Breakdown y la Instrucción: ambos leen este campo.
CREATE OR REPLACE FUNCTION disb_recalc_total() RETURNS trigger AS $$
DECLARE d_id int;
BEGIN
  d_id := COALESCE(NEW.disbursement_id, OLD.disbursement_id);
  IF EXISTS (SELECT 1 FROM disbursement WHERE id = d_id) THEN
    UPDATE disbursement d SET total_amount =
      (SELECT COALESCE(SUM(amount),0) FROM disbursement_line WHERE disbursement_id=d_id)
      - d.credit_applied
    WHERE d.id = d_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_disb_total AFTER INSERT OR UPDATE OR DELETE ON disbursement_line
  FOR EACH ROW EXECUTE FUNCTION disb_recalc_total();

-- Aprobado = congelado. Para cambiar algo se emite un sub-desembolso (#24.1).
CREATE OR REPLACE FUNCTION disb_lines_locked() RETURNS trigger AS $$
DECLARE st text; no int; sub int;
BEGIN
  SELECT d.status, d.disb_no, d.disb_sub INTO st, no, sub FROM disbursement d
   WHERE d.id = COALESCE(NEW.disbursement_id, OLD.disbursement_id);
  IF EXISTS (SELECT 1 FROM disb_status WHERE code = st AND is_locked) THEN
    RAISE EXCEPTION
      'El desembolso #%.% está en estado "%" — emita un sub-desembolso #%.% en lugar de editarlo',
      no, sub, st, no, sub + 1;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_disb_lines_locked BEFORE INSERT OR UPDATE OR DELETE ON disbursement_line
  FOR EACH ROW EXECUTE FUNCTION disb_lines_locked();

-- ---------------------------------------------------------------------------
-- 9. Bancos y flujo de fondos
-- ---------------------------------------------------------------------------
CREATE TABLE account_role (code text PRIMARY KEY, label text NOT NULL);
INSERT INTO account_role VALUES
 ('escrow','Cuenta escrow'), ('operating','Cuenta operativa'), ('source','Cuenta origen');

CREATE TABLE bank_account (
  id         serial PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  role       text NOT NULL REFERENCES account_role(code) DEFAULT 'operating',
  iban       text,
  currency   char(3) NOT NULL DEFAULT 'USD',   -- ya hay una cuenta en CRC
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bank_tx (
  id            bigserial PRIMARY KEY,
  account_id    int  NOT NULL REFERENCES bank_account(id),
  tx_date       date NOT NULL,
  txn_no        text,
  description   text,
  debit         numeric(16,2),
  credit        numeric(16,2),
  balance       numeric(16,2),
  class_code    text,                      -- FKs al final: esas tablas van después
  reconciled_ledger_id bigint,
  wire_id       int,
  fund_movement_id int,
  import_batch  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Idempotencia al reimportar. Incluye descripción y montos porque LAFISE
  -- le pone a la comisión el MISMO número de confirmación que a la
  -- transferencia que la origina: la clave corta las descartaría.
  UNIQUE NULLS NOT DISTINCT (account_id, tx_date, txn_no, description, debit, credit)
);
CREATE INDEX ON bank_tx (account_id, tx_date);
CREATE INDEX ON bank_tx (reconciled_ledger_id);
CREATE INDEX ON bank_tx (class_code);
CREATE INDEX ON bank_tx (wire_id);
CREATE INDEX ON bank_tx (fund_movement_id);
CREATE INDEX ON bank_tx (import_batch);

CREATE TABLE wire_transfer (
  id              serial PRIMARY KEY,
  disbursement_id int  REFERENCES disbursement(id) ON DELETE SET NULL,
  wire_date       date NOT NULL,
  value_date      date,                                -- fecha en que acreditó
  sender          text NOT NULL DEFAULT 'Hovde Master LLC',
  from_bank       text,                                -- SunWest
  to_account_id   int  NOT NULL REFERENCES bank_account(id),
  currency        char(3) NOT NULL DEFAULT 'USD',
  amount_sent     numeric(16,2) NOT NULL,              -- lo que ELLOS enviaron
  amount_received numeric(16,2),                       -- lo que ENTRÓ a la cuenta
  reference       text,                                -- No. de transacción
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT received_not_over_sent CHECK (amount_received IS NULL OR amount_received <= amount_sent)
);
CREATE INDEX ON wire_transfer (disbursement_id);
CREATE INDEX ON wire_transfer (to_account_id);
CREATE INDEX ON wire_transfer (wire_date);
CREATE TRIGGER trg_touch_wire BEFORE UPDATE ON wire_transfer
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Comisiones que se quedan los bancos en el camino.
-- Ruta real: Hovde/SunWest -> Citibank (intermediario) -> LAFISE (beneficiario)
CREATE TABLE fee_type (
  code text PRIMARY KEY, label text NOT NULL, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO fee_type VALUES
 ('sending',      'Banco emisor (SunWest)',        1),
 ('intermediary', 'Banco intermediario (Citibank)',2),
 ('beneficiary',  'Banco beneficiario (LAFISE)',   3),
 ('fx',           'Diferencial cambiario',         4),
 ('other',        'Otra',                          5),
 ('unidentified', 'Sin identificar el cobrador',   9);

CREATE TABLE wire_fee (
  id           bigserial PRIMARY KEY,
  wire_id      int  NOT NULL REFERENCES wire_transfer(id) ON DELETE CASCADE,
  fee_type     text NOT NULL REFERENCES fee_type(code),
  bank_name    text,
  amount       numeric(16,2) NOT NULL CHECK (amount > 0),
  is_estimated boolean NOT NULL DEFAULT false,   -- true = deducida, no documentada
  ledger_entry_id bigint,   -- FK se agrega abajo: ledger_entry se define después
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON wire_fee (wire_id);
CREATE TRIGGER trg_touch_wirefee BEFORE UPDATE ON wire_fee
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE INDEX ON wire_fee (fee_type);
CREATE INDEX ON wire_fee (ledger_entry_id);

-- La ecuación tiene que cerrar: enviado - comisiones = recibido.
-- Se valida al final de la transacción para poder cargar wire y comisiones juntos.
-- Regla: NO se puede asignar más comisión que la diferencia real observada.
-- Lo que todavía no se explicó NO bloquea: queda como "sin explicar" y sale
-- en v_wire_pending. El wire cae hoy; la comisión se identifica después.
CREATE OR REPLACE FUNCTION wire_fees_balance() RETURNS trigger AS $$
DECLARE w record; total_fees numeric; brecha numeric; target int;
BEGIN
  IF TG_TABLE_NAME = 'wire_fee' THEN
    target := COALESCE(NEW.wire_id, OLD.wire_id);
  ELSE
    target := COALESCE(NEW.id, OLD.id);
  END IF;

  SELECT * INTO w FROM wire_transfer WHERE id = target;
  IF NOT FOUND OR w.amount_received IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(amount),0) INTO total_fees FROM wire_fee WHERE wire_id = w.id;
  brecha := w.amount_sent - w.amount_received;

  IF total_fees - brecha > 0.005 THEN
    RAISE EXCEPTION
      'Wire %: las comisiones (%) superan la diferencia real entre enviado (%) y recibido (%), que es %',
      w.id, total_fees, w.amount_sent, w.amount_received, brecha;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_wire_fee_balance
  AFTER INSERT OR UPDATE OR DELETE ON wire_fee
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION wire_fees_balance();
CREATE CONSTRAINT TRIGGER trg_wire_balance
  AFTER INSERT OR UPDATE ON wire_transfer
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION wire_fees_balance();

-- Atajo: registrar la comisión como la diferencia observada, sin desglosar
CREATE OR REPLACE FUNCTION wire_absorb_difference(p_wire int, p_type text DEFAULT 'unidentified')
RETURNS numeric AS $$
DECLARE w record; f numeric; diff numeric;
BEGIN
  SELECT * INTO w FROM wire_transfer WHERE id = p_wire;
  SELECT COALESCE(SUM(amount),0) INTO f FROM wire_fee WHERE wire_id = p_wire;
  diff := w.amount_sent - f - w.amount_received;
  IF diff > 0 THEN
    INSERT INTO wire_fee (wire_id, fee_type, amount, is_estimated, note)
    VALUES (p_wire, p_type, diff, true, 'Diferencia deducida del estado de cuenta');
  END IF;
  RETURN diff;
END $$ LANGUAGE plpgsql;

CREATE TABLE fund_movement (
  id              serial PRIMARY KEY,
  disbursement_id int  REFERENCES disbursement(id) ON DELETE SET NULL,
  move_date       date NOT NULL,
  from_account_id int  NOT NULL REFERENCES bank_account(id),
  to_account_id   int  NOT NULL REFERENCES bank_account(id),
  amount          numeric(16,2) NOT NULL,
  fx_rate         numeric(16,6),               -- compra de colones con dólares
  reference       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distinct_accounts CHECK (from_account_id <> to_account_id)
);
CREATE INDEX ON fund_movement (disbursement_id);
CREATE INDEX ON fund_movement (from_account_id);
CREATE INDEX ON fund_movement (to_account_id);

-- ---------------------------------------------------------------------------
-- 9b. Clasificación de movimientos bancarios y cargos de cuenta
--
--     Hay DOS capas de comisión distintas:
--       1. USA -> escrow  : comisión de wire ($25-40)  -> wire_fee
--       2. Cuenta LAFISE  : $4,00 por transferencia + $1,50 mensual  -> aquí
--     La segunda no se pide en el short payment del mes, pero hay que
--     recuperarla cada cierto tiempo para que el flujo cierre contra la cuenta.
-- ---------------------------------------------------------------------------
CREATE TABLE bank_movement_class (
  code       text PRIMARY KEY,
  label      text NOT NULL,
  is_charge  boolean NOT NULL DEFAULT false,   -- resta: hay que recuperarlo
  is_income  boolean NOT NULL DEFAULT false,   -- suma: compensa cargos
  sort_order int NOT NULL DEFAULT 0
);
INSERT INTO bank_movement_class VALUES
 ('interest',       'Intereses ganados',            false,true ,1),
 ('transfer_fee',   'Comisión por transferencia',   true ,false,2),
 ('admin_charge',   'Cargo administrativo',         true ,false,3),
 ('fx_charge',      'Comisión por cambio',          true ,false,4),
 ('escrow_funding', 'Fondeo desde cuenta escrow',   false,false,5),
 ('payment',        'Pago a proveedor',             false,false,6),
 ('other',          'Sin clasificar',               false,false,9);

-- Las reglas son DATO, no código: se editan sin tocar el sistema
CREATE TABLE bank_classification_rule (
  id         serial PRIMARY KEY,
  pattern    text NOT NULL,                    -- se compara contra la descripción
  class_code text NOT NULL REFERENCES bank_movement_class(code),
  match_side text NOT NULL DEFAULT 'any' CHECK (match_side IN ('debit','credit','any')),
  priority   int  NOT NULL DEFAULT 100,
  is_active  boolean NOT NULL DEFAULT true,
  note       text
);
INSERT INTO bank_classification_rule (pattern,class_code,match_side,priority,note) VALUES
 ('^INTERESES',                 'interest',      'credit',10,'LAFISE abona interés diario'),
 ('^COMISI.N',                  'transfer_fee',  'debit', 20,'$4,00 fijos por transferencia'),
 ('CARGO ADMINISTRATIVO',       'admin_charge',  'debit', 30,'$1,50 mensuales'),
 ('PV2 DEPLOYMENT',             'escrow_funding','credit',40,'Traslado desde la cuenta escrow');

CREATE OR REPLACE FUNCTION classify_bank_tx() RETURNS trigger AS $$
DECLARE c text;
BEGIN
  IF NEW.class_code IS NOT NULL AND NEW.class_code <> 'other' THEN RETURN NEW; END IF;
  SELECT r.class_code INTO c
    FROM bank_classification_rule r
   WHERE r.is_active
     AND upper(COALESCE(NEW.description,'')) ~ upper(r.pattern)
     AND (r.match_side = 'any'
          OR (r.match_side = 'debit'  AND COALESCE(NEW.debit,0)  > 0)
          OR (r.match_side = 'credit' AND COALESCE(NEW.credit,0) > 0))
   ORDER BY r.priority
   LIMIT 1;
  NEW.class_code := COALESCE(c, CASE WHEN COALESCE(NEW.debit,0) > 0
                                     THEN 'payment' ELSE 'other' END);
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Recuperación de cargos: qué línea de qué desembolso cubre qué periodo
CREATE TABLE charge_recovery (
  id                   bigserial PRIMARY KEY,
  disbursement_line_id bigint NOT NULL REFERENCES disbursement_line(id) ON DELETE CASCADE,
  account_id           int  NOT NULL REFERENCES bank_account(id),
  period_from          date NOT NULL,
  period_to            date NOT NULL,
  amount               numeric(16,2) NOT NULL,
  note                 text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recovery_period CHECK (period_to >= period_from)
);
CREATE INDEX ON charge_recovery (disbursement_line_id);
CREATE INDEX ON charge_recovery (account_id, period_from);

CREATE TRIGGER trg_touch_banktx BEFORE UPDATE ON bank_tx
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_touch_fundmov BEFORE UPDATE ON fund_movement
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- FKs de bank_tx que apuntan a tablas definidas más abajo
ALTER TABLE bank_tx ADD CONSTRAINT bank_tx_class_fk
  FOREIGN KEY (class_code) REFERENCES bank_movement_class(code);
ALTER TABLE bank_tx ADD CONSTRAINT bank_tx_wire_fk
  FOREIGN KEY (wire_id) REFERENCES wire_transfer(id) ON DELETE SET NULL;
ALTER TABLE bank_tx ADD CONSTRAINT bank_tx_fundmov_fk
  FOREIGN KEY (fund_movement_id) REFERENCES fund_movement(id) ON DELETE SET NULL;

CREATE TRIGGER trg_classify_bank_tx BEFORE INSERT OR UPDATE ON bank_tx
  FOR EACH ROW EXECUTE FUNCTION classify_bank_tx();

-- ---------------------------------------------------------------------------
-- 10. Facturas (estructura lista; UI a futuro)
-- ---------------------------------------------------------------------------
CREATE TABLE invoice (
  id         bigserial PRIMARY KEY,
  invoice_no text NOT NULL,
  payee_id   int  NOT NULL REFERENCES payee(id),
  issue_date date NOT NULL,
  due_date   date,
  currency   char(3) NOT NULL DEFAULT 'USD',
  subtotal   numeric(16,2),
  tax        numeric(16,2),
  total      numeric(16,2) NOT NULL,
  file_pdf   bytea,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payee_id, invoice_no),
  CONSTRAINT invoice_dates CHECK (due_date IS NULL OR due_date >= issue_date)
);
CREATE INDEX ON invoice (payee_id);
CREATE TRIGGER trg_touch_invoice BEFORE UPDATE ON invoice
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE invoice_line (
  id          bigserial PRIMARY KEY,
  invoice_id  bigint NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
  line_no     int NOT NULL,
  description text NOT NULL,
  quantity    numeric(14,4),
  unit_price  numeric(16,4),
  amount      numeric(16,2) NOT NULL,
  wbs_id      int REFERENCES wbs_item(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, line_no)
);
CREATE INDEX ON invoice_line (invoice_id);
CREATE INDEX ON invoice_line (wbs_id);

-- ---------------------------------------------------------------------------
-- 11. Ledger — multimoneda, reportes dolarizados
-- ---------------------------------------------------------------------------
CREATE TABLE ledger_status (
  code text PRIMARY KEY, label text NOT NULL,
  generates_credit boolean NOT NULL DEFAULT false, sort_order int NOT NULL DEFAULT 0
);
INSERT INTO ledger_status VALUES
 ('pending', 'Pendiente de pago',        false,1),  -- todavía se va a pagar
 ('partial', 'Pagado parcialmente',      false,2),
 ('paid',    'Pagado',                   false,3),
 ('released','Liberado — no se pagará',  true ,4);  -- ← el dinero queda en cuenta
-- 'released' es la decisión explícita de que ese pago no se hace. Recién ahí
-- el saldo se convierte en crédito disponible, no antes.
CREATE TABLE ledger_entry (
  id              bigserial PRIMARY KEY,
  wbs_id          int  REFERENCES wbs_item(id),
  disbursement_id int  REFERENCES disbursement(id) ON DELETE SET NULL,
  invoice_id      bigint REFERENCES invoice(id) ON DELETE SET NULL,
  payee_id        int  REFERENCES payee(id),
  bank_tx_id      bigint REFERENCES bank_tx(id),
  entry_date      date,          -- ver constraint: obligatoria si hubo pago
  invoice_no      text,
  description     text,
  currency        char(3) NOT NULL DEFAULT 'USD',
  amount          numeric(16,2) NOT NULL,        -- en la moneda original
  fx_rate         numeric(16,6) NOT NULL DEFAULT 1,
  amount_usd      numeric(16,2) GENERATED ALWAYS AS (ROUND(amount * fx_rate, 2)) STORED,
  amount_paid_usd numeric(16,2) GENERATED ALWAYS AS (ROUND(amount_paid * fx_rate, 2)) STORED,
  amount_paid     numeric(16,2) NOT NULL DEFAULT 0,
  amount_due      numeric(16,2) GENERATED ALWAYS AS (amount - amount_paid) STORED,
  funding_source  text,
  status          text NOT NULL REFERENCES ledger_status(code) DEFAULT 'pending',
  released_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usd_rate_is_one CHECK (currency <> 'USD' OR fx_rate = 1),
  -- Un PAGO sin fecha no existe. Un COMPROMISO todavía no pagado, sí:
  -- es presupuesto comprometido, no gasto, y no tiene fecha de transacción.
  CONSTRAINT pago_exige_fecha CHECK (amount_paid = 0 OR entry_date IS NOT NULL),
  CONSTRAINT released_needs_reason CHECK (status <> 'released' OR released_reason IS NOT NULL)
);
CREATE INDEX ON ledger_entry (status);
CREATE INDEX ON ledger_entry (wbs_id, entry_date);
CREATE INDEX ON ledger_entry (disbursement_id);
CREATE INDEX ON ledger_entry (invoice_id);
CREATE INDEX ON ledger_entry (payee_id);
CREATE INDEX ON ledger_entry (bank_tx_id);
CREATE TRIGGER trg_touch_ledger BEFORE UPDATE ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE bank_tx ADD CONSTRAINT bank_tx_ledger_fk
  FOREIGN KEY (reconciled_ledger_id) REFERENCES ledger_entry(id) ON DELETE SET NULL;
ALTER TABLE wire_fee ADD CONSTRAINT wire_fee_ledger_fk
  FOREIGN KEY (ledger_entry_id) REFERENCES ledger_entry(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 11b. Cuenta de control de créditos
--      Origen: asientos del ledger liberados (pago que no se hizo).
--      El dinero ya está en la cuenta; queda como saldo a favor.
--      Cada mes se decide aplicar todo, una parte, o nada.
-- ---------------------------------------------------------------------------

-- Ajustes que NO vienen del ledger (diferencias de cambio, comisiones, etc.)
CREATE TABLE credit_adjustment (
  id          bigserial PRIMARY KEY,
  entry_date  date NOT NULL,
  amount      numeric(16,2) NOT NULL,     -- + suma al saldo, − lo reduce
  description text NOT NULL,
  created_by  int REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Aplicación de crédito a un desembolso: vos decidís el monto
CREATE TABLE credit_application (
  id              bigserial PRIMARY KEY,
  disbursement_id int  NOT NULL REFERENCES disbursement(id) ON DELETE CASCADE,
  applied_date    date NOT NULL DEFAULT CURRENT_DATE,
  amount          numeric(16,2) NOT NULL CHECK (amount > 0),
  note            text,
  applied_by      int REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON credit_application (disbursement_id);

-- Movimientos de la cuenta: acumulaciones (del ledger y ajustes) y aplicaciones
CREATE VIEW v_credit_movement AS
SELECT 'accrual'::text AS kind, l.entry_date AS move_date,
       ROUND((l.amount - l.amount_paid) * l.fx_rate, 2)::numeric(16,2) AS amount,
       'Liberado: ' || COALESCE(l.description,'') || ' — ' || COALESCE(l.released_reason,'') AS description,
       l.id AS source_id, NULL::int AS disbursement_id
FROM ledger_entry l
JOIN ledger_status s ON s.code = l.status
WHERE s.generates_credit AND (l.amount - l.amount_paid) <> 0
UNION ALL
SELECT 'adjustment', a.entry_date, a.amount::numeric(16,2), a.description, a.id, NULL
FROM credit_adjustment a
UNION ALL
SELECT 'application', ca.applied_date, (-ca.amount)::numeric(16,2),
       'Aplicado a desembolso #' || d.disb_no || '.' || d.disb_sub,
       ca.id, ca.disbursement_id
FROM credit_application ca JOIN disbursement d ON d.id = ca.disbursement_id;

-- Estado de cuenta con saldo corrido
CREATE VIEW v_credit_ledger AS
SELECT move_date, kind, description, amount,
       SUM(amount) OVER (ORDER BY move_date, kind, source_id
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::numeric(16,2) AS balance
FROM v_credit_movement
ORDER BY move_date, kind, source_id;

-- Saldo disponible hoy
CREATE VIEW v_credit_balance AS
SELECT COALESCE(SUM(amount) FILTER (WHERE kind <> 'application'), 0)::numeric(16,2) AS acumulado,
       COALESCE(-SUM(amount) FILTER (WHERE kind =  'application'), 0)::numeric(16,2) AS aplicado,
       COALESCE(SUM(amount), 0)::numeric(16,2)                                       AS disponible
FROM v_credit_movement;

-- No se puede aplicar más crédito del disponible
CREATE OR REPLACE FUNCTION credit_not_overdrawn() RETURNS trigger AS $$
DECLARE saldo numeric;
BEGIN
  SELECT disponible INTO saldo FROM v_credit_balance;
  IF saldo < 0 THEN
    RAISE EXCEPTION 'Crédito insuficiente: el saldo quedaría en %', saldo;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_credit_balance
  AFTER INSERT OR UPDATE ON credit_application
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION credit_not_overdrawn();

-- disbursement.credit_applied se mantiene solo desde las aplicaciones
CREATE OR REPLACE FUNCTION sync_credit_applied() RETURNS trigger AS $$
DECLARE d_id int;
BEGIN
  d_id := COALESCE(NEW.disbursement_id, OLD.disbursement_id);
  UPDATE disbursement SET credit_applied =
    (SELECT COALESCE(SUM(amount),0) FROM credit_application WHERE disbursement_id = d_id)
  WHERE id = d_id;
  UPDATE disbursement d SET total_amount =
    (SELECT COALESCE(SUM(amount),0) FROM disbursement_line WHERE disbursement_id = d_id)
    - d.credit_applied
  WHERE d.id = d_id;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_sync_credit AFTER INSERT OR UPDATE OR DELETE ON credit_application
  FOR EACH ROW EXECUTE FUNCTION sync_credit_applied();

-- ---------------------------------------------------------------------------
-- 12. Auditoría — ahora sí con autor
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  table_name  text NOT NULL,
  record_id   bigint NOT NULL,
  field       text NOT NULL,
  old_value   text,
  new_value   text,
  user_id     text,                       -- ← se llena desde current_app_user()
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (table_name, record_id);
CREATE INDEX ON audit_log (changed_at DESC);

CREATE OR REPLACE FUNCTION audit_columns() RETURNS trigger AS $$
DECLARE col text; oldv text; newv text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', col, col)
      INTO oldv, newv USING OLD, NEW;
    IF oldv IS DISTINCT FROM newv THEN
      INSERT INTO audit_log(table_name, record_id, field, old_value, new_value, user_id)
      VALUES (TG_TABLE_NAME, NEW.id, col, oldv, newv, current_app_user());
    END IF;
  END LOOP;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_wbs AFTER UPDATE ON wbs_item
  FOR EACH ROW EXECUTE FUNCTION audit_columns('category_id','phase_id','state_id','title','kind');
CREATE TRIGGER trg_audit_disb AFTER UPDATE ON disbursement
  FOR EACH ROW EXECUTE FUNCTION audit_columns('status','total_amount','credit_applied','approved_by');
CREATE TRIGGER trg_audit_cell AFTER UPDATE ON schedule_cell
  FOR EACH ROW EXECUTE FUNCTION audit_columns('planned_amount','state_id');
CREATE TRIGGER trg_audit_ledger AFTER UPDATE ON ledger_entry
  FOR EACH ROW EXECUTE FUNCTION audit_columns('amount','amount_paid','wbs_id','fx_rate','status');

-- ============================================================================
-- 13. VISTAS
-- ============================================================================

CREATE VIEW v_wbs_financials AS
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

CREATE VIEW v_timeline_detail AS
SELECT f.*, s.week_start, s.planned_amount, ts.code AS cell_state
FROM v_wbs_financials f
LEFT JOIN schedule_cell s  ON s.wbs_id = f.id
LEFT JOIN task_state    ts ON ts.id = s.state_id;

CREATE VIEW v_timeline AS
SELECT f.category, f.phase, s.week_start,
       SUM(f.budget_revised) AS budget_revised,
       SUM(f.spend)          AS spend,
       SUM(f.remaining)      AS remaining,
       SUM(s.planned_amount) AS planned
FROM v_wbs_financials f
LEFT JOIN schedule_cell s ON s.wbs_id = f.id
GROUP BY f.category, f.phase, s.week_start;

CREATE VIEW v_timeline_month AS
SELECT category, phase, date_trunc('month', week_start)::date AS month, SUM(planned) AS planned
FROM v_timeline GROUP BY 1,2,3;

CREATE VIEW v_reassignment_queue AS
SELECT w.id, w.wbs_code, w.title, c.name AS category, p.name AS phase,
       CASE WHEN w.category_id IS NULL THEN 'SIN CATEGORIA'
            WHEN w.phase_id    IS NULL THEN 'SIN FASE' END AS issue
FROM wbs_item w
LEFT JOIN category c ON c.id=w.category_id
LEFT JOIN phase    p ON p.id=w.phase_id
WHERE w.is_active AND w.kind <> 'section_header'
  AND (w.category_id IS NULL OR w.phase_id IS NULL);

CREATE VIEW v_disbursement_trace AS
SELECT d.disb_no, d.disb_sub, d.period_month, d.status,
       d.total_amount                        AS solicitado,
       COALESCE(w.enviado,0)                 AS enviado_por_corporativo,
       COALESCE(w.recibido,0)                AS neto_recibido_escrow,
       COALESCE(m.trasladado,0)              AS trasladado_operativa,
       COALESCE(l.pagado,0)                  AS pagado,
       d.total_amount - COALESCE(l.pagado,0) AS pendiente_pago
FROM disbursement d
LEFT JOIN LATERAL (SELECT SUM(COALESCE(amount_received,amount_sent)) recibido,
                          SUM(amount_sent) enviado
                   FROM wire_transfer WHERE disbursement_id=d.id) w ON true
LEFT JOIN LATERAL (SELECT SUM(amount) trasladado FROM fund_movement WHERE disbursement_id=d.id) m ON true
LEFT JOIN LATERAL (SELECT SUM(amount_paid) pagado FROM ledger_entry WHERE disbursement_id=d.id) l ON true
ORDER BY d.disb_no, d.disb_sub;

CREATE VIEW v_disbursement_gaps AS
SELECT g AS disb_no_faltante
FROM generate_series((SELECT MIN(disb_no) FROM disbursement),
                     (SELECT MAX(disb_no) FROM disbursement)) g
WHERE NOT EXISTS (SELECT 1 FROM disbursement WHERE disb_no = g AND disb_sub = 0);

CREATE VIEW v_budget_vs_actual AS
SELECT f.wbs_code, f.title, f.category, f.phase, f.budget_revised,
       COALESCE(dl.comprometido,0) AS comprometido_en_desembolsos,
       f.spend                     AS pagado,
       f.budget_revised - f.spend  AS disponible
FROM v_wbs_financials f
LEFT JOIN LATERAL (SELECT SUM(amount) comprometido
                   FROM disbursement_line WHERE wbs_id=f.id) dl ON true
WHERE f.kind = 'cost';

CREATE VIEW v_breakdown_pdf AS
SELECT d.disb_no, d.disb_sub, d.period_month, d.send_date,
       dl.line_no, dl.description, dl.amount,
       c.name AS category, p.name AS type, dl.reason,
       pe.name AS payee_name, 'SEND' AS transfer,
       pe.bank_name, pe.legal_id AS beneficiary, pe.iban AS account,
       d.credit_applied, d.total_amount
FROM disbursement d
JOIN disbursement_line dl ON dl.disbursement_id = d.id
LEFT JOIN category c  ON c.id  = dl.category_id
LEFT JOIN phase    p  ON p.id  = dl.phase_id
LEFT JOIN payee    pe ON pe.id = dl.payee_id
ORDER BY d.disb_no, d.disb_sub, dl.line_no;

-- Conciliación del wire: solicitado -> enviado -> comisiones -> neto recibido
CREATE VIEW v_wire_reconciliation AS
SELECT w.id, w.wire_date, w.reference,
       d.disb_no, d.disb_sub, d.period_month,
       d.total_amount                              AS solicitado,
       w.amount_sent                               AS enviado,
       w.amount_sent - COALESCE(d.total_amount,0)  AS dif_solicitado_enviado,
       COALESCE(f.comisiones,0)                    AS comisiones,
       w.amount_received                           AS neto_recibido,
       w.amount_sent - COALESCE(f.comisiones,0)
         - COALESCE(w.amount_received,0)           AS sin_explicar,
       CASE WHEN w.amount_sent = 0 THEN NULL
            ELSE ROUND(COALESCE(f.comisiones,0) / w.amount_sent * 100, 4)
       END                                         AS pct_comision,
       b.name                                      AS cuenta_destino
FROM wire_transfer w
LEFT JOIN disbursement d ON d.id = w.disbursement_id
LEFT JOIN bank_account b ON b.id = w.to_account_id
LEFT JOIN LATERAL (SELECT SUM(amount) comisiones FROM wire_fee WHERE wire_id=w.id) f ON true
ORDER BY w.wire_date;

-- Cuánto se están quedando los bancos, por banco y por tipo
CREATE VIEW v_bank_fees AS
SELECT ft.label AS tipo, wf.fee_type, COALESCE(wf.bank_name,'(sin identificar)') AS banco,
       count(*) AS wires, SUM(wf.amount) AS total,
       ROUND(AVG(wf.amount),2) AS promedio,
       MIN(wf.amount) AS minimo, MAX(wf.amount) AS maximo,
       count(*) FILTER (WHERE wf.is_estimated) AS estimadas
FROM wire_fee wf JOIN fee_type ft ON ft.code = wf.fee_type
GROUP BY ft.label, ft.sort_order, wf.fee_type, wf.bank_name
ORDER BY ft.sort_order, SUM(wf.amount) DESC;

-- Costo anual de mover la plata
CREATE VIEW v_bank_fees_by_year AS
SELECT EXTRACT(year FROM w.wire_date)::int AS anio,
       count(DISTINCT w.id) AS wires,
       SUM(w.amount_sent)   AS enviado,
       SUM(COALESCE(f.comisiones,0)) AS comisiones,
       ROUND(SUM(COALESCE(f.comisiones,0)) / NULLIF(SUM(w.amount_sent),0) * 100, 4) AS pct
FROM wire_transfer w
LEFT JOIN LATERAL (SELECT SUM(amount) comisiones FROM wire_fee WHERE wire_id=w.id) f ON true
GROUP BY 1 ORDER BY 1;

-- Wires sin conciliar: falta el neto, o falta ligarlos a su desembolso
CREATE VIEW v_wire_pending AS
SELECT w.id, w.wire_date, w.reference, w.amount_sent, w.amount_received,
       w.amount_sent - COALESCE(f.fees,0) - COALESCE(w.amount_received,0) AS sin_explicar,
       CASE WHEN w.disbursement_id IS NULL          THEN 'sin desembolso asignado'
            WHEN w.amount_received IS NULL          THEN 'falta el neto recibido'
            ELSE 'comisión sin identificar'
       END AS pendiente
FROM wire_transfer w
LEFT JOIN LATERAL (SELECT SUM(amount) fees FROM wire_fee WHERE wire_id=w.id) f ON true
WHERE w.disbursement_id IS NULL
   OR w.amount_received IS NULL
   OR abs(w.amount_sent - COALESCE(f.fees,0) - w.amount_received) > 0.005
ORDER BY w.wire_date;

-- Cargos e intereses de la cuenta, por mes. Esta es la pestaña que faltaba.
CREATE VIEW v_bank_charges_monthly AS
SELECT b.id AS account_id, b.name AS cuenta,
       date_trunc('month', t.tx_date)::date AS mes,
       SUM(t.debit)  FILTER (WHERE t.class_code='transfer_fee')  AS comision_transf,
       count(*)      FILTER (WHERE t.class_code='transfer_fee')  AS n_transf,
       SUM(t.debit)  FILTER (WHERE t.class_code='admin_charge')  AS cargo_admin,
       SUM(t.debit)  FILTER (WHERE t.class_code='fx_charge')     AS comision_cambio,
       COALESCE(SUM(t.debit)  FILTER (WHERE c.is_charge),0)      AS total_cargos,
       COALESCE(SUM(t.credit) FILTER (WHERE c.is_income),0)      AS intereses,
       COALESCE(SUM(t.credit) FILTER (WHERE c.is_income),0)
         - COALESCE(SUM(t.debit) FILTER (WHERE c.is_charge),0)   AS neto
FROM bank_tx t
JOIN bank_account b ON b.id = t.account_id
LEFT JOIN bank_movement_class c ON c.code = t.class_code
GROUP BY b.id, b.name, date_trunc('month', t.tx_date)
ORDER BY b.name, 3;

-- Cargos que todavía NO se pidieron en ningún short payment
-- Una recuperación puede cubrir varios meses. El monto se PRORRATEA según
-- los cargos reales de cada mes; asignarle el total a cada uno daría por
-- cubiertos meses que todavía no se pidieron.
CREATE VIEW v_charge_recovery_applied AS
SELECT cr.id AS recovery_id, cr.account_id, m.mes,
       cr.amount * m.total_cargos
         / NULLIF(SUM(m.total_cargos) OVER (PARTITION BY cr.id), 0) AS aplicado
FROM charge_recovery cr
JOIN v_bank_charges_monthly m
  ON m.account_id = cr.account_id
 AND m.mes BETWEEN date_trunc('month', cr.period_from)::date
               AND date_trunc('month', cr.period_to)::date
WHERE m.total_cargos > 0;

CREATE VIEW v_charges_pending_recovery AS
SELECT m.account_id, m.cuenta, m.mes, m.total_cargos, m.intereses, m.neto,
       ROUND(COALESCE(r.recuperado,0),2)                     AS recuperado,
       ROUND(m.total_cargos - COALESCE(r.recuperado,0),2)    AS por_recuperar
FROM v_bank_charges_monthly m
LEFT JOIN LATERAL (
  SELECT SUM(aplicado) recuperado FROM v_charge_recovery_applied a
   WHERE a.account_id = m.account_id AND a.mes = m.mes) r ON true
WHERE m.total_cargos - COALESCE(r.recuperado,0) > 0.005
ORDER BY m.mes;

-- Fondeos recibidos en la cuenta operativa contra el desembolso que los originó
CREATE VIEW v_funding_reconciliation AS
SELECT t.tx_date, t.description, t.credit AS entro_a_cuenta,
       d.disb_no, d.disb_sub, d.period_month, d.total_amount AS solicitado,
       t.credit - d.total_amount AS diferencia
FROM bank_tx t
LEFT JOIN fund_movement fm ON fm.id = t.fund_movement_id
LEFT JOIN disbursement d   ON d.id  = fm.disbursement_id
WHERE t.class_code = 'escrow_funding'
ORDER BY t.tx_date;

-- Cada comisión comparte el número de confirmación con la transferencia que
-- la generó: eso permite ver qué pago costó qué comisión.
CREATE VIEW v_transfer_fee_detail AS
SELECT f.account_id, f.tx_date, f.txn_no,
       f.debit                AS comision,
       p.description          AS pago_relacionado,
       p.debit                AS monto_pago,
       ROUND(f.debit / NULLIF(p.debit,0) * 100, 4) AS pct_sobre_pago,
       l.wbs_id
FROM bank_tx f
LEFT JOIN bank_tx p
       ON p.account_id = f.account_id AND p.tx_date = f.tx_date
      AND p.txn_no = f.txn_no AND p.id <> f.id
      AND p.class_code NOT IN ('transfer_fee','admin_charge')
LEFT JOIN ledger_entry l ON l.id = p.reconciled_ledger_id
WHERE f.class_code = 'transfer_fee'
ORDER BY f.tx_date DESC;

-- Movimientos que el importador no supo clasificar: la bandeja de trabajo
CREATE VIEW v_bank_unclassified AS
SELECT t.id, b.name AS cuenta, t.tx_date, t.description, t.debit, t.credit, t.class_code
FROM bank_tx t JOIN bank_account b ON b.id=t.account_id
WHERE t.class_code IN ('other','payment') AND t.reconciled_ledger_id IS NULL
ORDER BY t.tx_date DESC;

CREATE TABLE instruction_template (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  escrow_agreement_date date NOT NULL,
  purchaser     text NOT NULL,
  escrow_agent  text NOT NULL,
  agent_legal_id text NOT NULL,
  body_md       text NOT NULL,
  payment_block jsonb NOT NULL,
  signer_name   text NOT NULL,
  signer_title  text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
