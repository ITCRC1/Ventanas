"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  ApprovalInfo,
  AuthConfig,
  BankAccount,
  BankChargeMonth,
  BankFee,
  BankFeeYear,
  BankTx,
  BankUnclassified,
  Category,
  CreditAdjustment,
  CreditBalance,
  CreditMovement,
  Disbursement,
  DisbursementDetail,
  EscrowDraw,
  Invoice,
  InvoiceDetail,
  LedgerPayment,
  LedgerRow,
  LedgerSheetRow,
  MovementClass,
  Payee,
  Phase,
  ProjectMeta,
  Recurring,
  ScheduleCell,
  ShortPaymentBatch,
  TaskState,
  TimelineDetailRow,
  TimelineRollupRow,
  UsWireRow,
  UsWireSheet,
  User,
  Wbs,
  WbsFinancials,
  Weeks,
  WireRecon,
} from "./types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<User>("/auth/me"),
    retry: false,
  });
}

export function useAuthConfig() {
  return useQuery({
    queryKey: ["auth-config"],
    queryFn: () => api.get<AuthConfig>("/auth/config"),
    retry: false,
  });
}

export function useDevLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => api.post<User>("/auth/dev-login", { username }),
    onSuccess: (user) => qc.setQueryData(["me"], user),
  });
}

export function useSharedLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api.post<User>("/auth/shared-login", { password }),
    onSuccess: (user) => qc.setQueryData(["me"], user),
  });
}

export function usePasswordLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; password: string }) => api.post<User>("/auth/login", v),
    onSuccess: (user) => qc.setQueryData(["me"], user),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout", {}),
    onSuccess: () => qc.clear(),
  });
}

export function useFinancials() {
  return useQuery({
    queryKey: ["wbs", "financials"],
    queryFn: () => api.get<WbsFinancials[]>("/wbs/financials"),
  });
}

// Reportes de solo lectura del cronograma (vistas v_timeline / v_timeline_detail).
// Los tabs Timeline / Timeline Detail se arman con financials + cells + weeks
// (mismo patrón que Job Cost); estos exponen las vistas agregadas de la base.
export function useTimeline() {
  return useQuery({
    queryKey: ["reports", "timeline"],
    queryFn: () => api.get<TimelineRollupRow[]>("/reports/timeline?limit=500"),
  });
}

export function useTimelineDetail() {
  return useQuery({
    queryKey: ["reports", "timeline-detail"],
    queryFn: () => api.get<TimelineDetailRow[]>("/reports/timeline-detail?limit=500"),
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/categories?only_active=true"),
  });
}

export function usePhases() {
  return useQuery({
    queryKey: ["phases"],
    queryFn: () => api.get<Phase[]>("/phases"),
  });
}

// Cambia el color del proyecto/categoría (usado para pintar la ejecución).
export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; color_hex: string }) =>
      api.patch(`/categories/${vars.id}`, { color_hex: vars.color_hex }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useReassign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; category_id: number | null; phase_id: number | null }) =>
      api.put(`/wbs/${vars.id}/assignment`, {
        category_id: vars.category_id,
        phase_id: vars.phase_id,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wbs"] });
    },
  });
}

export function useSetForecast() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; forecast_total: number | null }) =>
      api.patch(`/wbs/${vars.id}`, { forecast_total: vars.forecast_total }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wbs"] }),
  });
}

// Edita un override del Job Cost (Original/Changes/Spend); la vista recalcula
// Revised/Remaining/Over-Under con fórmulas al refetch.
export function useUpdateWbsField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, number | null>) =>
      api.patch(`/wbs/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wbs"] }),
  });
}

// Fechas del Job Cost (Start/Due). El backend recalcula Duration = DAYS360 en la vista.
export function useUpdateWbsDates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: { id: number } & { start_date?: string | null; due_date?: string | null }) =>
      api.patch(`/wbs/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wbs"] }),
  });
}

// Edita campos de identidad del WBS (Task Title, Owner, Estado, Anular). Acepta
// texto/numérico/booleano; la vista recalcula derivados al refetch de ["wbs"].
type WbsMetaPatch = {
  title?: string;
  owner?: string | null;
  state_id?: number;
  kind?: string;
  is_active?: boolean;
};
export function useEditWbsMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & WbsMetaPatch) => api.patch(`/wbs/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wbs"] }),
  });
}

// Crea una nueva línea WBS desde Job Cost (POST /wbs). El código debe ser único
// (el backend responde 409 si ya existe). Aparece al instante al invalidar ["wbs"].
export function useCreateWbs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      wbs_code: string;
      title: string;
      owner?: string | null;
      category_id?: number | null;
      phase_id?: number | null;
      budget_original_ovr?: number | null;
    }) => api.post<Wbs>("/wbs", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wbs"] }),
  });
}

// Metadata de cabecera del reporte (título, PM, empresa, corte, última actualización).
export function useProjectMeta() {
  return useQuery({
    queryKey: ["meta", "project"],
    queryFn: () => api.get<ProjectMeta>("/meta/project"),
  });
}

export function useWbsList() {
  return useQuery({
    queryKey: ["wbs", "list"],
    queryFn: () => api.get<Wbs[]>("/wbs?only_active=true&limit=500"),
  });
}

export function useTaskStates() {
  return useQuery({
    queryKey: ["task-states"],
    queryFn: () => api.get<TaskState[]>("/meta/task-states"),
  });
}

export function useScheduleWeeks() {
  return useQuery({
    queryKey: ["schedule", "weeks"],
    queryFn: () => api.get<Weeks>("/schedule/weeks"),
  });
}

export function useCutoff() {
  return useQuery({
    queryKey: ["schedule", "cutoff"],
    queryFn: () => api.get<{ cutoff_date: string | null }>("/schedule/cutoff"),
  });
}

export function useSetCutoff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cutoff_date: string) => api.put("/schedule/cutoff", { cutoff_date }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule", "cutoff"] });
      qc.invalidateQueries({ queryKey: ["wbs"] }); // el forecast depende del cutoff
    },
  });
}

export function useScheduleCells() {
  return useQuery({
    queryKey: ["schedule", "cells"],
    queryFn: () => api.get<ScheduleCell[]>("/schedule/cells"),
  });
}

export function useUpsertCell() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      wbs_id: number;
      week_start: string;
      planned_amount: number | null;
      state_id: number;
    }) => api.put<ScheduleCell>("/schedule/cell", vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule", "cells"] });
      // El Forecast del Job Cost = Spend + timeline futuro (>= cutoff) sale de
      // estas celdas → invalidar ["wbs"] para que Job Cost / Timeline /
      // Timeline Detail / Dashboard refresquen el Forecast en vivo.
      qc.invalidateQueries({ queryKey: ["wbs"] });
    },
  });
}

export function useClearCell() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { wbs_id: number; week_start: string }) =>
      api.del(`/schedule/cell?wbs_id=${vars.wbs_id}&week_start=${vars.week_start}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule", "cells"] });
      // Igual que el upsert: limpiar una celda cambia el timeline futuro y por
      // tanto el Forecast derivado → refrescar el maestro ["wbs"].
      qc.invalidateQueries({ queryKey: ["wbs"] });
    },
  });
}

// Guardado por LOTE (pegar desde Excel / rellenar / borrar en bloque). Un solo
// request para muchas celdas. planned_amount null en un item = borra esa celda.
export function useUpsertCells() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      cells: {
        wbs_id: number;
        week_start: string;
        planned_amount: number | null;
        state_id?: number;
      }[],
    ) => api.put<{ ok: boolean; count: number }>("/schedule/cells", { cells }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule", "cells"] });
      qc.invalidateQueries({ queryKey: ["wbs"] });
    },
  });
}

// --- Short Payment (desembolsos) --------------------------------------------

export function usePayees() {
  return useQuery({ queryKey: ["payees"], queryFn: () => api.get<Payee[]>("/payees") });
}

export function useCreatePayee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Payee>) => api.post<Payee>("/payees", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payees"] }),
  });
}

export function useRecurring() {
  return useQuery({ queryKey: ["recurring"], queryFn: () => api.get<Recurring[]>("/recurring") });
}

export function useCreateRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Recurring>) => api.post<Recurring>("/recurring", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring"] }),
  });
}

export function useDisbursements() {
  return useQuery({
    queryKey: ["disbursements"],
    queryFn: () => api.get<Disbursement[]>("/disbursements"),
  });
}

export function useDisbursement(id: number | null) {
  return useQuery({
    queryKey: ["disbursement", id],
    queryFn: () => api.get<DisbursementDetail>(`/disbursements/${id}`),
    enabled: id !== null,
  });
}

// Invalida las tres vistas que comparten los datos del desembolso: el detalle,
// la lista y el Short Payment List (la otra pestaña que lee las mismas líneas).
function invalidateDisb(qc: ReturnType<typeof useQueryClient>, id: number) {
  qc.invalidateQueries({ queryKey: ["disbursement", id] });
  qc.invalidateQueries({ queryKey: ["disbursements"] });
  qc.invalidateQueries({ queryKey: ["short-payments"] });
}

function useDisbMutation<T>(fn: (id: number, body?: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body?: T }) => fn(id, body),
    onSuccess: (_r, { id }) => invalidateDisb(qc, id),
  });
}

// Edita el encabezado del desembolso (período/fecha/notas en borrador; número
// oficial en cualquier estado). Los derivados los recalcula la vista al refetch.
export function useUpdateDisbursement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      disb_no?: number;
      period_month?: string;
      send_date?: string | null;
      notes?: string | null;
    }) => api.patch(`/disbursements/${id}`, body),
    onSuccess: (_r, { id }) => invalidateDisb(qc, id),
  });
}

// Edita una línea de un desembolso en borrador (descripción, monto, factura,
// nota, proveedor). El total lo recomputa el trigger; la vista refetchea.
export function useUpdateLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      disbId: number;
      lineId: number;
      body: {
        description?: string;
        invoice_no?: string | null;
        vendor?: string | null;
        amount?: number;
        reason?: string | null;
        payee_id?: number | null;
        transfer?: string | null;
      };
    }) => api.patch(`/disbursements/${v.disbId}/lines/${v.lineId}`, v.body),
    onSuccess: (_r, { disbId }) => invalidateDisb(qc, disbId),
  });
}

export function useCreateDisbursement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { period_month: string; send_date?: string | null }) =>
      api.post<DisbursementDetail>("/disbursements", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["disbursements"] });
      qc.invalidateQueries({ queryKey: ["short-payments"] });
    },
  });
}

export function useAddLine() {
  return useDisbMutation<{ description: string; amount: number; payee_id: number | null }>(
    (id, body) => api.post(`/disbursements/${id}/lines`, body),
  );
}

export function useDeleteLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ disbId, lineId }: { disbId: number; lineId: number }) =>
      api.del(`/disbursements/${disbId}/lines/${lineId}`),
    onSuccess: (_r, { disbId }) => invalidateDisb(qc, disbId),
  });
}

export function usePreloadRecurring() {
  return useDisbMutation((id) => api.post(`/disbursements/${id}/preload-recurring`, {}));
}

// Devuelve la tanda a borrador (des-enviar / des-aprobar) para corregirla.
export function useReopenDisbursement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number }) => api.post(`/disbursements/${id}/reopen`, {}),
    onSuccess: (_r, { id }) => {
      invalidateDisb(qc, id);
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
}

export function useSubmitDisbursement() {
  return useDisbMutation((id) => api.post(`/disbursements/${id}/submit`, {}));
}

export function useApproveDisbursement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: number }) => api.post(`/disbursements/${id}/approve`, {}),
    onSuccess: (_r, { id }) => {
      qc.invalidateQueries({ queryKey: ["disbursement", id] });
      qc.invalidateQueries({ queryKey: ["disbursements"] });
      qc.invalidateQueries({ queryKey: ["approvals", id] });
    },
  });
}

export function useApprovals(id: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ["approvals", id],
    queryFn: () => api.get<ApprovalInfo>(`/disbursements/${id}/approvals`),
    enabled: id !== null && enabled,
  });
}

// --- Créditos (Fase 7) ------------------------------------------------------

export function useCreditBalance() {
  return useQuery({
    queryKey: ["credit", "balance"],
    queryFn: () => api.get<CreditBalance>("/credit/balance"),
  });
}

export function useCreditLedger() {
  return useQuery({
    queryKey: ["credit", "ledger"],
    queryFn: () => api.get<CreditMovement[]>("/credit/ledger"),
  });
}

export function useCreditAdjustments() {
  return useQuery({
    queryKey: ["credit", "adjustments"],
    queryFn: () => api.get<CreditAdjustment[]>("/credit/adjustment"),
  });
}

export function useCreateAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { entry_date: string; amount: number; description: string }) =>
      api.post("/credit/adjustment", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["credit"] }),
  });
}

// Edita un ajuste manual existente. El saldo corrido (derivado) refetchea.
export function useUpdateAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: number;
      body: { entry_date?: string; amount?: number; description?: string };
    }) => api.patch(`/credit/adjustment/${v.id}`, v.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["credit"] }),
  });
}

// Anula un ajuste manual. Si al quitarlo el saldo queda negativo, la API lo rechaza.
export function useDeleteAdjustment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/credit/adjustment/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["credit"] }),
  });
}

export function useApplyCredit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { disbId: number; amount: number; note?: string }) =>
      api.post<DisbursementDetail>(`/disbursements/${vars.disbId}/credit`, {
        amount: vars.amount,
        note: vars.note,
      }),
    onSuccess: (_r, { disbId }) => {
      qc.invalidateQueries({ queryKey: ["disbursement", disbId] });
      qc.invalidateQueries({ queryKey: ["disbursements"] });
      qc.invalidateQueries({ queryKey: ["credit"] });
    },
  });
}

// --- Bancos y wires (Fase 9) ------------------------------------------------

export function useBankAccounts() {
  return useQuery({
    queryKey: ["bank", "accounts"],
    queryFn: () => api.get<BankAccount[]>("/bank/accounts"),
  });
}

export function useBankStatement(accountId: number | null) {
  return useQuery({
    queryKey: ["bank", "statement", accountId],
    queryFn: () => api.get<BankTx[]>(`/bank/statement?account_id=${accountId}`),
    enabled: accountId !== null,
  });
}

export function useWireReconciliation() {
  return useQuery({
    queryKey: ["bank", "reconciliation"],
    queryFn: () => api.get<WireRecon[]>("/bank/reconciliation"),
  });
}

export function useUsWireTransfers() {
  return useQuery({
    queryKey: ["bank", "us-wire-transfers"],
    queryFn: () => api.get<UsWireRow[]>("/bank/us-wire-transfers"),
  });
}

// Tab "US Wire Transfers" — control de aportes de los dueños (espejo del Excel).
export function useUsWiresSheet() {
  return useQuery({
    queryKey: ["us-wires"],
    queryFn: () => api.get<UsWireSheet>("/us-wires"),
  });
}

export function useCreateUsWire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { block: string }) => api.post("/us-wires", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["us-wires"] }),
  });
}

export function useUpdateUsWire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      api.patch(`/us-wires/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["us-wires"] }),
  });
}

export function useDeleteUsWire() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/us-wires/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["us-wires"] }),
  });
}

export function useSetLafiseBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lafise_balance: number | null) =>
      api.put("/us-wires/lafise-balance", { lafise_balance }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["us-wires"] }),
  });
}

export function useBankChargesMonthly() {
  return useQuery({
    queryKey: ["bank", "charges-monthly"],
    queryFn: () => api.get<BankChargeMonth[]>("/bank/charges-monthly"),
  });
}

export function useBankChargesPending() {
  return useQuery({
    queryKey: ["bank", "charges-pending"],
    queryFn: () => api.get<BankChargeMonth[]>("/bank/charges-pending"),
  });
}

export function useBankFees() {
  return useQuery({
    queryKey: ["bank", "fees"],
    queryFn: () => api.get<BankFee[]>("/bank/fees"),
  });
}

export function useBankFeesByYear() {
  return useQuery({
    queryKey: ["bank", "fees-by-year"],
    queryFn: () => api.get<BankFeeYear[]>("/bank/fees-by-year"),
  });
}

export function useBankUnclassified() {
  return useQuery({
    queryKey: ["bank", "unclassified"],
    queryFn: () => api.get<BankUnclassified[]>("/bank/unclassified"),
  });
}

export function useMovementClasses() {
  return useQuery({
    queryKey: ["bank", "movement-classes"],
    queryFn: () => api.get<MovementClass[]>("/bank/movement-classes"),
  });
}

function useBankInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["bank"] });
}

export function useCreateWire() {
  const invalidate = useBankInvalidate();
  return useMutation({
    mutationFn: (body: {
      wire_date: string;
      to_account_id: number;
      amount_sent: number;
      value_date?: string | null;
      amount_received?: number | null;
      disbursement_id?: number | null;
      reference?: string;
    }) => api.post("/bank/wires", body),
    onSuccess: invalidate,
  });
}

export function useAddWireFee() {
  const invalidate = useBankInvalidate();
  return useMutation({
    mutationFn: (vars: {
      wireId: number;
      fee_type: string;
      amount: number;
      bank_name?: string;
    }) =>
      api.post(`/bank/wires/${vars.wireId}/fees`, {
        fee_type: vars.fee_type,
        amount: vars.amount,
        bank_name: vars.bank_name,
      }),
    onSuccess: invalidate,
  });
}

export function useAbsorbWire() {
  const invalidate = useBankInvalidate();
  return useMutation({
    mutationFn: (wireId: number) => api.post(`/bank/wires/${wireId}/absorb`, {}),
    onSuccess: invalidate,
  });
}

export function useClassifyTx() {
  const invalidate = useBankInvalidate();
  return useMutation({
    mutationFn: (vars: { txId: number; class_code: string }) =>
      api.patch(`/bank/tx/${vars.txId}/classify`, { class_code: vars.class_code }),
    onSuccess: invalidate,
  });
}

// Edita los INPUTS de un movimiento bancario (monto/fecha/descripción/cuenta/tipo).
// El saldo del estado de cuenta es derivado: se recalcula al refetch.
export function useUpdateBankTx() {
  const invalidate = useBankInvalidate();
  return useMutation({
    mutationFn: (vars: {
      txId: number;
      tx_date?: string;
      txn_no?: string | null;
      description?: string | null;
      debit?: number | null;
      credit?: number | null;
      account_id?: number;
      class_code?: string;
    }) => {
      const { txId, ...body } = vars;
      return api.patch(`/bank/tx/${txId}`, body);
    },
    onSuccess: invalidate,
  });
}

// Edita los campos de ENTRADA de un wire (fecha, fecha valor, enviado, referencia…).
// Conciliación/comisiones/neto son derivados: se recalculan al refetch.
export function useUpdateWire() {
  const invalidate = useBankInvalidate();
  return useMutation({
    mutationFn: (vars: {
      wireId: number;
      wire_date?: string;
      value_date?: string | null;
      amount_sent?: number;
      amount_received?: number | null;
      reference?: string | null;
      note?: string | null;
    }) => {
      const { wireId, ...body } = vars;
      return api.patch(`/bank/wires/${wireId}`, body);
    },
    onSuccess: invalidate,
  });
}

// --- Facturas (Fase 10) -----------------------------------------------------

export function useInvoices() {
  return useQuery({ queryKey: ["invoices"], queryFn: () => api.get<Invoice[]>("/invoices") });
}

export function useInvoice(id: number | null) {
  return useQuery({
    queryKey: ["invoice", id],
    queryFn: () => api.get<InvoiceDetail>(`/invoices/${id}`),
    enabled: id !== null,
  });
}

function useInvoiceInvalidate() {
  const qc = useQueryClient();
  return (id?: number) => {
    qc.invalidateQueries({ queryKey: ["invoices"] });
    if (id != null) qc.invalidateQueries({ queryKey: ["invoice", id] });
  };
}

export function useCreateInvoice() {
  const invalidate = useInvoiceInvalidate();
  return useMutation({
    mutationFn: (body: {
      invoice_no: string;
      payee_id: number;
      issue_date: string;
      tax?: number | null;
      lines: { description: string; amount: number; wbs_id: number | null }[];
    }) => api.post<InvoiceDetail>("/invoices", body),
    onSuccess: () => invalidate(),
  });
}

// Edita la cabecera. subtotal/total son derivados: la BD los recalcula y devuelve.
export function useUpdateInvoice() {
  const invalidate = useInvoiceInvalidate();
  return useMutation({
    mutationFn: (vars: {
      id: number;
      invoice_no?: string;
      payee_id?: number;
      issue_date?: string;
      due_date?: string | null;
      tax?: number | null;
      notes?: string | null;
    }) => {
      const { id, ...body } = vars;
      return api.patch<InvoiceDetail>(`/invoices/${id}`, body);
    },
    onSuccess: (_r, { id }) => invalidate(id),
  });
}

export function useDeleteInvoice() {
  const invalidate = useInvoiceInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.del(`/invoices/${id}`),
    onSuccess: (_r, id) => invalidate(id),
  });
}

export function useAddInvoiceLine() {
  const invalidate = useInvoiceInvalidate();
  return useMutation({
    mutationFn: (vars: {
      invoiceId: number;
      description: string;
      amount: number;
      wbs_id?: number | null;
    }) => {
      const { invoiceId, ...body } = vars;
      return api.post<InvoiceDetail>(`/invoices/${invoiceId}/lines`, body);
    },
    onSuccess: (_r, { invoiceId }) => invalidate(invoiceId),
  });
}

export function useUpdateInvoiceLine() {
  const invalidate = useInvoiceInvalidate();
  return useMutation({
    mutationFn: (vars: {
      invoiceId: number;
      lineId: number;
      description?: string;
      amount?: number;
      wbs_id?: number | null;
    }) => {
      const { invoiceId, lineId, ...body } = vars;
      return api.patch<InvoiceDetail>(`/invoices/${invoiceId}/lines/${lineId}`, body);
    },
    onSuccess: (_r, { invoiceId }) => invalidate(invoiceId),
  });
}

export function useDeleteInvoiceLine() {
  const invalidate = useInvoiceInvalidate();
  return useMutation({
    mutationFn: (vars: { invoiceId: number; lineId: number }) =>
      api.del<InvoiceDetail>(`/invoices/${vars.invoiceId}/lines/${vars.lineId}`),
    onSuccess: (_r, { invoiceId }) => invalidate(invoiceId),
  });
}

// --- LEDGER (Excel) ---------------------------------------------------------

export function useLedger() {
  return useQuery({
    queryKey: ["reports", "ledger"],
    queryFn: () => api.get<LedgerRow[]>("/reports/ledger?limit=500"),
  });
}

export function useLedgerSheet() {
  return useQuery({
    queryKey: ["ledger", "sheet"],
    queryFn: () => api.get<LedgerSheetRow[]>("/ledger/sheet"),
  });
}

export function useUpdateLedgerLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { lineId: number; amount_paid?: number; wbs_id?: number }) =>
      api.patch(`/ledger/line/${vars.lineId}`, {
        amount_paid: vars.amount_paid,
        wbs_id: vars.wbs_id,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ledger", "sheet"] }),
  });
}

export function useImportDisbursement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (disb_no: number) =>
      api.post<{
        ok: boolean;
        disb_no: number;
        imported: number; // filas nuevas
        updated: number; // ya estaban y se refrescaron (sin perder lo trabajado)
        removed: number; // líneas que ya no están en el Short Payment
        kept_from_excel: number;
      }>("/ledger/import-disbursement", { disb_no }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ledger", "sheet"] });
      qc.invalidateQueries({ queryKey: ["wbs"] }); // el Spend del Job Cost sale del Ledger
    },
  });
}

export interface DeployResult {
  placed: number;
  week?: string;
  message?: string;
  conflicts: { wbs_code: string; weeks: string[]; total: string }[];
}
export function useDeployToJobCost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (disb_no: number) =>
      api.post<DeployResult>("/ledger/deploy-to-jobcost", { disb_no }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule", "cells"] });
      qc.invalidateQueries({ queryKey: ["wbs"] });
    },
  });
}

type LedgerRowPatch = {
  amount_paid?: number;
  wbs_id?: number;
  payment_id?: number;
  entry_date?: string;
  invoice_no?: string;
  payee?: string;
  description?: string;
  paid_total?: string;
  date_paid?: string;
  payment_info?: string;
  bank_paid_from?: string;
  request?: string;
  notes?: string;
};

export function useUpdateLedgerSheetRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rowId, ...body }: { rowId: number } & LedgerRowPatch) =>
      api.patch(`/ledger/sheet/${rowId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ledger", "sheet"] });
      qc.invalidateQueries({ queryKey: ["ledger", "payments"] });
      qc.invalidateQueries({ queryKey: ["wbs"] }); // el Spend del Job Cost sale del Ledger
    },
  });
}

export function useLedgerPayments() {
  return useQuery({
    queryKey: ["ledger", "payments"],
    queryFn: () => api.get<LedgerPayment[]>("/ledger/payments"),
  });
}

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { label: string; total_amount: number; notes?: string }) =>
      api.post<{ id: number; label: string }>("/ledger/payments", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ledger", "payments"] }),
  });
}

export function useEscrowDraws() {
  return useQuery({
    queryKey: ["reports", "disbursement-trace"],
    queryFn: () => api.get<EscrowDraw[]>("/reports/disbursement-trace?limit=500"),
  });
}

// --- Short Term Payments (Excel) --------------------------------------------

export function useShortPayments() {
  return useQuery({
    queryKey: ["short-payments"],
    queryFn: () => api.get<ShortPaymentBatch[]>("/disbursements/short-payments"),
  });
}

type ShortLineBody = {
  description?: string;
  category_id?: number | null;
  phase_id?: number | null;
  payee_name?: string | null;
  invoice_no?: string | null;
  amount?: number;
  reason?: string | null;
  transfer?: string | null;
};

export function useAddShortLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { disbId: number; body: ShortLineBody }) =>
      api.post(`/disbursements/${v.disbId}/lines`, v.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["short-payments"] }),
  });
}

export function useUpdateShortLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { disbId: number; lineId: number; body: ShortLineBody }) =>
      api.patch(`/disbursements/${v.disbId}/lines/${v.lineId}`, v.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["short-payments"] }),
  });
}

export function useDeleteShortLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { disbId: number; lineId: number }) =>
      api.del(`/disbursements/${v.disbId}/lines/${v.lineId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["short-payments"] }),
  });
}

export function useUpdateDisbNo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: number; disb_no: number }) =>
      api.patch(`/disbursements/${v.id}`, { disb_no: v.disb_no }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["short-payments"] }),
  });
}

// --- Planning (notas de revisión/aprobación) -------------------------------

export interface PlanningNote {
  wbs_id: number;
  note: string | null;
  suggested_amount: string | null;
  move_to_month: string | null;
}
export interface PlanningDoc {
  comments: string | null;
  share_token?: string | null;
  opened_count: number;
  opened_at: string | null;
  last_opened_at: string | null;
  submission_count: number;
  notes: PlanningNote[];
}

export function usePlanningDoc() {
  return useQuery({ queryKey: ["planning"], queryFn: () => api.get<PlanningDoc>("/planning") });
}

export function useLinkSubmissions(enabled: boolean) {
  return useQuery({
    queryKey: ["planning", "link-submissions"],
    queryFn: () => api.get<PackageSubmission[]>("/planning/submissions"),
    enabled,
  });
}

export function useDeleteLinkSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sid: number) => api.del(`/planning/submissions/${sid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planning"] }),
  });
}

export function useApplyPlanningNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      wbs_id: number;
      suggested_amount?: number | null;
      move_to_month?: string | null;
    }) => api.post<{ ok: boolean; description: string }>("/planning/apply-note", v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedule"] });
      qc.invalidateQueries({ queryKey: ["wbs", "financials"] });
      qc.invalidateQueries({ queryKey: ["planning"] });
    },
  });
}

export function useSavePlanningNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      wbs_id: number;
      note?: string | null;
      suggested_amount?: number | null;
      move_to_month?: string | null;
    }) => api.put("/planning/note", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planning"] }),
  });
}

export function useSavePlanningComments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (comments: string) => api.put("/planning/comments", { comments }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planning"] }),
  });
}

// --- Planning packages (paquetes de aprobación por mes) --------------------

export interface PlanningPackage {
  id: number;
  name: string;
  period_from: string | null;
  months: number;
  token: string;
  status: string;
  comments: string | null;
  created_at: string;
  opened_count: number;
  opened_at: string | null;
  last_opened_at: string | null;
  submission_count: number;
}

export interface PackageSubmission {
  id: number;
  reviewer_name: string | null;
  comments: string | null;
  notes: {
    wbs_id: number;
    note: string | null;
    suggested_amount: string | null;
    move_to_month: string | null;
  }[];
  submitted_at: string;
}

export function usePlanningPackages() {
  return useQuery({
    queryKey: ["planning", "packages"],
    queryFn: () => api.get<PlanningPackage[]>("/planning/packages"),
  });
}

export function usePackageSubmissions(pid: number | null) {
  return useQuery({
    queryKey: ["planning", "submissions", pid],
    queryFn: () => api.get<PackageSubmission[]>(`/planning/packages/${pid}/submissions`),
    enabled: pid != null,
  });
}

export function useDeleteSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pid: number; sid: number }) =>
      api.del(`/planning/packages/${v.pid}/submissions/${v.sid}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planning"] }),
  });
}

export function useCreatePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; period_from: string; months: number }) =>
      api.post<{ id: number; token: string }>("/planning/packages", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planning", "packages"] }),
  });
}

export function useDeletePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/planning/packages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["planning", "packages"] }),
  });
}

// ---- Invoice Receipts (bandeja de facturas por correo) ---------------------

export interface InvoiceReceipt {
  id: number;
  received_at: string | null;
  email_from: string | null;
  email_subject: string | null;
  doc_type: string | null;
  clave: string | null;
  invoice_no: string | null;
  issuer_name: string | null;
  issuer_id: string | null;
  invoice_date: string | null;
  currency: string | null;
  subtotal: string | null;
  tax: string | null;
  total: string | null;
  xml_filename: string | null;
  pdf_filename: string | null;
  has_pdf: boolean;
  has_xml_file: boolean;
  has_pdf_file: boolean;
  no_invoice: boolean;
  status: string;
  notes: string | null;
  links: LedgerLink[];
  linked_total_usd: number;
  // Línea del Short Payment creada desde esta factura (si ya se envió a corporativo).
  sp_line_id: number | null;
  sp_line_no: number | null;
  sp_amount: string | null;
  sp_disb_id: number | null;
  sp_disb_no: number | null;
  sp_disb_sub: number | null;
  sp_period_month: string | null;
  sp_status: string | null;
}

export interface OpenShortPayment {
  id: number;
  disb_no: number;
  disb_sub: number;
  period_month: string;
  send_date: string | null;
  status: string;
  total_amount: string;
  n_lines: number;
}

export interface LedgerLink {
  ledger_entry_id: number;
  invoice_no: string | null;
  description: string | null;
  amount: string | null;
  amount_usd: string | null;
  currency: string | null;
  entry_date: string | null;
  status: string | null;
  payee_name: string | null;
}

export interface LedgerCandidate {
  id: number;
  entry_date: string | null;
  invoice_no: string | null;
  description: string | null;
  amount: string | null;
  amount_usd: string | null;
  currency: string | null;
  status: string | null;
  payee_name: string | null;
  linked_here: boolean;
  linked_other: boolean;
}

export interface InvoiceReceiptStatus {
  configured: boolean;
  mailbox: string | null;
  last_sync_at: string | null;
  ref_fx: number | null; // TC ₡/US$ compartido (guardado en la base)
  counts: Record<string, number>;
  // Sync manual en segundo plano
  sync_running: boolean;
  sync_error: string | null;
  sync_last: { found: number; inserted: number; skipped: number } | null;
}

// TC de referencia ₡/US$: vive en la base (igual para todos); el localStorage
// queda solo como respaldo mientras carga o si el usuario no puede editarlo.
export function useRefFx() {
  const qc = useQueryClient();
  const status = useInvoiceReceiptStatus();
  const cached =
    typeof window !== "undefined" ? Number(window.localStorage.getItem("invoiceRefFx")) : 0;
  const value = status.data?.ref_fx ?? (cached > 0 ? cached : null);
  if (typeof window !== "undefined" && status.data?.ref_fx != null) {
    window.localStorage.setItem("invoiceRefFx", String(status.data.ref_fx));
  }
  const save = useMutation({
    mutationFn: (ref_fx: number | null) =>
      api.put<{ ok: boolean; ref_fx: number | null }>("/invoice-receipts/ref-fx", { ref_fx }),
    onSuccess: (_r, v) => {
      if (typeof window !== "undefined")
        window.localStorage.setItem("invoiceRefFx", v == null ? "" : String(v));
      qc.invalidateQueries({ queryKey: ["invoice-receipts"] });
    },
  });
  return { value, save };
}

export interface CycleStatus {
  disb_no: number;
  disb_sub: number;
  period_month: string;
  send_date: string | null;
  status: string;
  total_amount: string;
  lines: number;
  ledger_rows: number;
  ledger_no_code: number;
  invoiced_rows: number;
  invoices_pending: number;
  jobcost_codes: number;
  jobcost_placed: number;
}

export interface RunMonthResult {
  ok: boolean;
  disb_no: number;
  ledger: { imported: number; updated: number; removed: number };
  missing_cost_codes: number;
  jobcost: {
    placed: number;
    week?: string;
    message?: string;
    conflicts: { wbs_code: string; total: string }[];
  };
  invoices: { auto: number; review: number; applied: number; skipped: number };
}

// Corre el mes de una sola vez: Ledger → Job Cost → cruce de facturas.
export function useRunMonth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (disb_no: number) =>
      api.post<RunMonthResult>("/ledger/run-month", { disb_no, apply_matches: true }),
    onSuccess: () => {
      for (const k of [
        ["ledger"],
        ["wbs"],
        ["schedule"],
        ["short-payments"],
        ["cycle-status"],
        ["invoice-receipts"],
      ])
        qc.invalidateQueries({ queryKey: k });
    },
  });
}

// Estado del ciclo del mes (del #26 en adelante; lo anterior está validado).
export function useCycleStatus(fromNo = 26) {
  return useQuery({
    queryKey: ["cycle-status", fromNo],
    queryFn: () => api.get<CycleStatus[]>(`/disbursements/cycle-status?from_no=${fromNo}`),
  });
}

export interface LedgerOption {
  id: number;
  entry_date: string | null;
  invoice_no: string | null;
  description: string | null;
  amount_usd: string | null;
  status: string | null;
  payee_name: string | null;
}

export function useInvoiceReceipts() {
  return useQuery({
    queryKey: ["invoice-receipts"],
    queryFn: () => api.get<InvoiceReceipt[]>("/invoice-receipts"),
  });
}

export function useInvoiceReceiptStatus() {
  return useQuery({
    queryKey: ["invoice-receipts", "status"],
    queryFn: () => api.get<InvoiceReceiptStatus>("/invoice-receipts/status"),
    // Mientras el sync corre en segundo plano, se refresca solo cada 3 s.
    refetchInterval: (q) => (q.state.data?.sync_running ? 3000 : false),
  });
}

export function useSyncInvoiceReceipts() {
  const qc = useQueryClient();
  return useMutation({
    // Arranca el sync en segundo plano (contesta al toque). full=true barre todo
    // el buzón. El avance se ve en /status (sync_running / sync_last).
    mutationFn: (full?: boolean) =>
      api.post<{ configured: boolean; started: boolean; already_running: boolean }>(
        `/invoice-receipts/sync${full ? "?full=true" : ""}`,
        {},
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice-receipts"] }),
  });
}

export function useUpdateInvoiceReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      id: number;
      ledger_entry_id?: number | null;
      invoice_no?: string | null;
      notes?: string | null;
      status?: string | null;
    }) => {
      const { id, ...body } = v;
      return api.patch(`/invoice-receipts/${id}`, body);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice-receipts"] }),
  });
}

export function useDeleteInvoiceReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.del(`/invoice-receipts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice-receipts"] }),
  });
}

// Tanda del Short Payment abierta (borrador) — destino del botón "Add to SP".
export function useOpenShortPayment() {
  return useQuery({
    queryKey: ["invoice-receipts", "open-short-payment"],
    queryFn: () => api.get<OpenShortPayment | null>("/invoice-receipts/open-short-payment"),
  });
}

export interface ToShortPaymentResult {
  ok: boolean;
  disbursement_id: number;
  disb_no: number;
  disb_sub: number;
  period_month: string;
  line_id: number;
  line_no: number;
  amount_usd: string;
  description: string;
  invoice_total: string;
}

export function useAddToShortPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rid: number; ref_fx?: number | null; force?: boolean }) =>
      api.post<ToShortPaymentResult>(`/invoice-receipts/${v.rid}/to-short-payment`, {
        ref_fx: v.ref_fx ?? null,
        force: v.force ?? false,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoice-receipts"] });
      qc.invalidateQueries({ queryKey: ["short-payments"] });
      qc.invalidateQueries({ queryKey: ["disbursements"] });
    },
  });
}

export function useJustifyPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { detail: string; ledger_entry_ids: number[]; amount_usd?: number | null }) =>
      api.post<{ id: number; linked: number; total_usd: string }>("/invoice-receipts/justify", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice-receipts"] }),
  });
}

export function useCreateInvoiceReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      invoice_no?: string | null;
      issuer_name?: string | null;
      invoice_date?: string | null;
      currency?: string | null;
      total?: number | null;
      notes?: string | null;
    }) => api.post<{ id: number }>("/invoice-receipts", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice-receipts"] }),
  });
}

export interface AppliedInvoiceRef {
  receipt_id: number;
  invoice_no: string | null;
  issuer_name: string | null;
  currency: string | null;
  total: string | null;
  total_usd: number | null;
  shared: boolean;
}

export interface AppliedRow {
  ledger_id: number;
  entry_date: string | null;
  description: string | null;
  payee_name: string | null;
  status: string | null;
  ledger_currency: string | null;
  ledger_amount: number;
  fx_rate: number;
  ledger_usd: number;
  invoices: AppliedInvoiceRef[];
  inv_total_native: number;
  inv_total_usd: number;
  inv_currency: string | null;
  invoice_fx: number | null;
  implied_rate: number | null;
  mixed_currency: boolean;
  has_shared: boolean;
  missing_rate: boolean;
  diff_usd: number | null;
  diff_native: number | null;
}

export interface AppliedMirror {
  rows: AppliedRow[];
  totals: { ledger_usd: number; inv_total_usd: number; diff_usd: number; count: number };
  ref_fx: number | null;
}

export interface InvoicesByWbs {
  by_wbs: Record<string, number>;
  total_usd: number;
  missing_rate: number;
}

export interface MatchSuggestion {
  receipt_id: number;
  issuer_name: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  invoice_total: string | null;
  invoice_currency: string | null;
  invoice_usd: number | null;
  ledger_entry_id: number;
  ledger_desc: string | null;
  ledger_date: string | null;
  ledger_amount_usd: string | null;
  reasons: string[];
  score: number;
  tier: "auto" | "review";
}

export function useAutomatch() {
  return useMutation({
    mutationFn: (refFx?: number | null) =>
      api.post<{ suggestions: MatchSuggestion[]; auto: number; review: number }>(
        "/invoice-receipts/automatch",
        { ref_fx: refFx ?? null },
      ),
  });
}

export function useApplyMatches() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pairs: { receipt_id: number; ledger_entry_id: number }[]) =>
      api.post<{ applied: number; skipped: number }>("/invoice-receipts/automatch/apply", {
        pairs,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice-receipts"] }),
  });
}

export interface ReconLedgerRow {
  receipt_id: number | null;
  ledger_id: number;
  src_disb_no: number | null;
  month: string | null;
  entry_date: string | null;
  account: string | null;
  description: string | null;
  payee_name: string | null;
  wbs_code: string | null;
  wbs_title: string | null;
  led_amount: number;
  led_currency: string | null;
  led_usd: number;
  led_paid: number;
  led_due: number;
  status: string | null;
  has_invoice: boolean;
  doc_type: string | null;
  no_invoice: boolean;
  invoice_no: string | null;
  invoice_date: string | null;
  issuer_name: string | null;
  inv_currency: string | null;
  inv_total: number | null;
  inv_usd: number | null;
  note: string | null;
}

export function useReconstructedLedger(refFx?: number | null) {
  const qs = refFx && refFx > 0 ? `?ref_fx=${refFx}` : "";
  return useQuery({
    queryKey: ["invoice-receipts", "ledger-view", refFx ?? null],
    queryFn: () =>
      api.get<{ rows: ReconLedgerRow[]; count: number }>(`/invoice-receipts/ledger-view${qs}`),
  });
}

export function useInvoicesByWbs(refFx?: number | null) {
  const qs = refFx && refFx > 0 ? `?ref_fx=${refFx}` : "";
  return useQuery({
    queryKey: ["invoice-receipts", "by-wbs", refFx ?? null],
    queryFn: () => api.get<InvoicesByWbs>(`/invoice-receipts/by-wbs${qs}`),
  });
}

export function useInvoicesApplied(refFx?: number | null) {
  const qs = refFx && refFx > 0 ? `?ref_fx=${refFx}` : "";
  return useQuery({
    queryKey: ["invoice-receipts", "applied", refFx ?? null],
    queryFn: () => api.get<AppliedMirror>(`/invoice-receipts/applied${qs}`),
  });
}

export function useLinkCandidates(rid: number, q: string, showAll: boolean, enabled: boolean) {
  return useQuery({
    queryKey: ["invoice-receipts", "candidates", rid, q, showAll],
    queryFn: () =>
      api.get<LedgerCandidate[]>(
        `/invoice-receipts/${rid}/candidates?q=${encodeURIComponent(q)}&show_all=${showAll}`,
      ),
    enabled,
  });
}

export function useSetLinks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { rid: number; ledger_entry_ids: number[] }) =>
      api.post<{ ok: boolean; linked: number }>(`/invoice-receipts/${v.rid}/links`, {
        ledger_entry_ids: v.ledger_entry_ids,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice-receipts"] }),
  });
}

export function useLedgerOptions(q: string, enabled = true) {
  return useQuery({
    queryKey: ["invoice-receipts", "ledger-options", q],
    queryFn: () =>
      api.get<LedgerOption[]>(`/invoice-receipts/ledger-options?q=${encodeURIComponent(q)}`),
    enabled,
  });
}
