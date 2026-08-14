// Contratos que devuelve la API (Fase 3). Español en la UI, inglés en los datos.

export interface User {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  role: string;
  role_id: number;
  permissions: string[];
}

export interface AuthConfig {
  dev_login: boolean;
  shared_gate: boolean;
  oidc: boolean;
}

export interface Category {
  id: number;
  code: string;
  name: string;
  color_hex: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface Phase {
  id: number;
  category_id: number;
  code: string;
  name: string;
  sort_order: number;
}

export interface WbsFinancials {
  id: number;
  wbs_code: string;
  title: string;
  owner: string | null;
  kind: string;
  state: string;
  category: string | null;
  phase: string | null;
  budget_original: string;
  budget_change: string;
  budget_revised: string;
  spend: string;
  remaining: string;
  forecast: string;
  over_under: string;
  draw_no: number | null;
  start_date: string | null;
  due_date: string | null;
  duration_days: number | null;
  draw_no_first: number | null;
}

// Metadata de cabecera del Job Cost (hoja: Project Title / PM / Company / UPDATED).
export interface ProjectMeta {
  project_name: string | null;
  company: string | null;
  manager: string | null;
  report_currency: string | null;
  cutoff_date: string | null;
  horizon_start: string | null;
  horizon_end: string | null;
  updated_at: string | null;
}

// Reporte v_timeline_detail: cada línea del Job Cost (v_wbs_financials) por
// celda del cronograma (formato largo: una fila por WBS × semana).
export interface TimelineDetailRow extends WbsFinancials {
  week_start: string | null;
  planned_amount: string | null;
  cell_state: string | null;
}

// Reporte v_timeline: agregado por categoría + fase × semana.
export interface TimelineRollupRow {
  category: string | null;
  phase: string | null;
  week_start: string | null;
  budget_revised: string | null;
  spend: string | null;
  remaining: string | null;
  planned: string | null;
}

export interface Wbs {
  id: number;
  wbs_code: string;
  parent_id: number | null;
  title: string;
  owner: string | null;
  category_id: number | null;
  phase_id: number | null;
  state_id: number;
  kind: string;
  sort_order: number;
  is_active: boolean;
}

export interface TaskState {
  id: number;
  code: string;
  label: string;
  color_hex: string;
  requires_amount: boolean;
  is_committed: boolean;
  sort_order: number;
}

export interface ScheduleCell {
  wbs_id: number;
  week_start: string; // ISO date (lunes)
  planned_amount: string | null;
  state_id: number;
  note: string | null;
}

export interface Weeks {
  start: string | null;
  end: string | null;
  weeks: string[]; // lunes en ISO
}

export interface Payee {
  id: number;
  name: string;
  legal_id: string | null;
  bank_name: string | null;
  iban: string | null;
  currency: string;
  is_international: boolean;
  default_category_id: number | null;
  default_phase_id: number | null;
  is_active: boolean;
}

export interface Recurring {
  id: number;
  label: string;
  payee_id: number;
  wbs_id: number | null;
  reason: string | null;
  default_amount: string | null;
  currency: string;
  active_from: string;
  active_to: string | null;
  is_active: boolean;
}

export interface DisbLine {
  id: number;
  line_no: number;
  description: string;
  invoice_no: string | null;
  vendor: string | null; // proveedor de la factura (no es el beneficiario del pago)
  amount: string;
  currency: string;
  wbs_id: number | null;
  category_id: number | null;
  phase_id: number | null;
  reason: string | null;
  payee_id: number | null;
  recurring_id: number | null;
  transfer: string | null;
}

export interface Disbursement {
  id: number;
  disb_no: number;
  disb_sub: number;
  parent_id: number | null;
  period_month: string;
  send_date: string | null;
  status: string;
  credit_applied: string;
  total_amount: string;
  submitted_at: string | null;
  approved_at: string | null;
  notes: string | null;
}

export interface DisbursementDetail extends Disbursement {
  lines: DisbLine[];
}

export interface ShortPaymentLine {
  id: number | null;
  line_no: number;
  description: string;
  invoice_no: string | null;
  amount: string;
  wbs_code: string | null;
  wbs_title: string | null;
  category: string | null;
  type: string | null;
  category_id: number | null; // propios de la línea (editables); category/type pueden venir del WBS
  phase_id: number | null;
  reason: string | null;
  payee_name: string | null;
  transfer: string | null;
  bank_name: string | null;
  beneficiary: string | null;
  account: string | null;
}

export interface ShortPaymentBatch {
  id: number;
  disb_no: number;
  disb_sub: number;
  period_month: string;
  send_date: string | null;
  status: string;
  total_amount: string;
  lines: ShortPaymentLine[];
}

export interface ApprovalInfo {
  approvals: { approver_id: number; full_name: string; approved_at: string }[];
  threshold: string;
  needed: number;
  approved_count: number;
  fully_approved: boolean;
}

export interface CreditBalance {
  acumulado: string;
  aplicado: string;
  disponible: string;
}

export interface CreditMovement {
  move_date: string | null;
  kind: string;
  description: string | null;
  amount: string;
  balance: string;
}

export interface CreditAdjustment {
  id: number;
  entry_date: string;
  amount: string;
  description: string;
}

export interface BankAccount {
  id: number;
  name: string;
  role: string;
  currency: string;
  is_active: boolean;
}

export interface WireRecon {
  id: number;
  wire_date: string;
  value_date: string | null;
  reference: string | null;
  disb_no: number | null;
  disb_sub: number | null;
  solicitado: string | null;
  enviado: string;
  dif_solicitado_enviado: string | null;
  comisiones: string;
  neto_recibido: string | null;
  sin_explicar: string | null;
  pct_comision: string | null;
  cuenta_destino: string | null;
}

export interface BankTx {
  id: number;
  account_id: number;
  tx_date: string;
  txn_no: string | null;
  description: string | null;
  debit: string | null;
  credit: string | null;
  class_code: string | null;
  balance: string | null;
}

// Tab "US Wire Transfers" — control de aportes de los dueños (espejo del Excel).
export interface UsWireItem {
  id: number;
  block: string; // 'ventanas_i' | 'ventanas_ii'
  trans_label: string | null;
  wire_date: string | null;
  sender: string | null;
  from_party: string | null;
  to_party: string | null;
  account_number: string | null;
  amount_received: string;
  amount_sent: string | null;
  notas: string | null;
  running_balance: string;
}
export interface UsWireSheet {
  rows: UsWireItem[];
  total_received: string;
  block_totals: Record<string, string>;
  lafise_balance: string | null;
}

export interface UsWireRow {
  id: number;
  trans_no: number;
  wire_date: string;
  value_date: string | null;
  sender: string;
  from_bank: string | null;
  to_account_id: number;
  to_account: string;
  to_account_role: string;
  disbursement_id: number | null;
  disb_no: number | null;
  disb_sub: number | null;
  reference: string | null;
  currency: string;
  amount_sent: string;
  amount_received: string | null;
  note: string | null;
  running_balance: string;
}

export interface BankChargeMonth {
  account_id: number;
  cuenta: string;
  mes: string;
  total_cargos: string;
  intereses: string;
  neto: string;
  por_recuperar?: string;
}

export interface BankUnclassified {
  id: number;
  cuenta: string;
  tx_date: string;
  description: string | null;
  debit: string | null;
  credit: string | null;
  class_code: string | null;
}

export interface MovementClass {
  code: string;
  label: string;
  is_charge: boolean;
  is_income: boolean;
}

export interface BankFee {
  tipo: string;
  fee_type: string;
  banco: string;
  wires: number;
  total: string;
  promedio: string;
  minimo: string;
  maximo: string;
  estimadas: number;
}

export interface BankFeeYear {
  anio: number;
  wires: number;
  enviado: string;
  comisiones: string;
  pct: string | null;
}

export interface InvoiceLine {
  id: number;
  line_no: number;
  description: string;
  quantity: string | null;
  unit_price: string | null;
  amount: string;
  wbs_id: number | null;
}

export interface Invoice {
  id: number;
  invoice_no: string;
  payee_id: number;
  issue_date: string;
  due_date: string | null;
  currency: string;
  subtotal: string | null;
  tax: string | null;
  total: string;
  notes: string | null;
  status: string; // 'active' | 'void' (anulada)
}

export interface InvoiceDetail extends Invoice {
  lines: InvoiceLine[];
}

// LEDGER (hoja del Excel) — asientos con nombres resueltos por v_ledger.
export interface LedgerRow {
  id: number;
  cost_code: string | null;
  account: string | null;
  entry_date: string | null;
  invoice_no: string | null;
  payee: string | null;
  description: string | null;
  colones: string | null;
  amount: string | null;
  amount_paid: string | null;
  amount_due: string | null;
  status: string | null;
  bank_paid_from: string | null;
  notes: string | null;
}

// Espejo fiel de la hoja LEDGER (ledger_sheet_row) — se muestra tal cual el Excel.
export interface LedgerSheetRow {
  id: number;
  row_no: number;
  section: string;
  kind: "data" | "section" | "meta";
  cost_code: string | null;
  account: string | null;
  entry_date: string | null;
  invoice_no: string | null;
  payee: string | null;
  description: string | null;
  colones: string | null;
  amount: string | null;
  amount_paid: string | null;
  amount_due: string | null;
  paid_total: string | null;
  date_paid: string | null;
  payment_info: string | null;
  bank_paid_from: string | null;
  request: string | null;
  notes: string | null;
  // Reflejo editable de Short Payments (desde ago-2026). Histórico = editable:false.
  editable?: boolean;
  line_id?: number | null;
  // Pago en cuotas al que pertenece esta línea (si aplica).
  payment_id?: number | null;
  payment_label?: string | null;
}

// Pago que se reparte en cuotas entre varios Disbursements.
export interface LedgerPayment {
  id: number;
  label: string;
  total_amount: string;
  notes: string | null;
  allocated: string;
  remaining: string;
  installments: number;
}

// Bloque escrow del LEDGER — REQUESTED / RECEIVED / RELEASED / REMAINING,
// derivado de v_disbursement_trace.
export interface EscrowDraw {
  disb_no: number;
  disb_sub: number;
  period_month: string;
  status: string;
  solicitado: string;
  enviado_por_corporativo: string;
  neto_recibido_escrow: string;
  trasladado_operativa: string;
  pagado: string;
  pendiente_pago: string;
}
