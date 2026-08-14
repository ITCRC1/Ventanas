"use client";

import { ApiError } from "@/lib/api";
import {
  useCreatePayment,
  useDeployToJobCost,
  useEscrowDraws,
  useImportDisbursement,
  useLedgerPayments,
  useLedgerSheet,
  useUpdateLedgerLine,
  useUpdateLedgerSheetRow,
  useWbsList,
} from "@/lib/hooks";
import type { LedgerPayment, LedgerSheetRow, Wbs } from "@/lib/types";
import { useState } from "react";

const dec2 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// $1,234.56 — como el Excel (con $, 2 decimales; $0.00 se muestra; vacío = celda en blanco)
function usd2(v: string | number | null): string {
  if (v === null || v === "") return "";
  const n = Number(v);
  if (Number.isNaN(n)) return "";
  return n < 0 ? `($${dec2.format(Math.abs(n))})` : `$${dec2.format(n)}`;
}
function num(v: string | null): number {
  // Tolera valores ya formateados ($1,234.56) al releer un input editable.
  const n = Number(String(v ?? "0").replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? 0 : n;
}

// 16 columnas: etiqueta (6) · Amount/Paid/Due · 7 finales (incl. Pago).
const COLS = 16;

function EscrowPanel() {
  const draws = useEscrowDraws();
  const rows = draws.data ?? [];
  if (rows.length === 0) return null;
  const t = rows.reduce(
    (a, d) => ({
      req: a.req + num(d.solicitado),
      rec: a.rec + num(d.neto_recibido_escrow),
      rel: a.rel + num(d.trasladado_operativa),
    }),
    { req: 0, rec: 0, rel: 0 },
  );
  return (
    <details className="rounded-lg border border-slate-200 bg-white">
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
        Escrow / Funding — Requested ${dec2.format(t.req)} · Received ${dec2.format(t.rec)} ·
        Released ${dec2.format(t.rel)} · Remaining ${dec2.format(t.rec - t.rel)}
      </summary>
      <div className="overflow-x-auto border-t border-slate-200">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Draw</th>
              <th className="px-3 py-2">Period</th>
              <th className="px-3 py-2 text-right">Requested</th>
              <th className="px-3 py-2 text-right">Received in Escrow</th>
              <th className="px-3 py-2 text-right">Released from Escrow</th>
              <th className="px-3 py-2 text-right">Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((d) => (
              <tr key={`${d.disb_no}.${d.disb_sub}`}>
                <td className="whitespace-nowrap px-3 py-1.5 font-medium">
                  #{d.disb_no}
                  {d.disb_sub ? `.${d.disb_sub}` : ""}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">{d.period_month}</td>
                <td className="tabular px-3 py-1.5 text-right text-blue-700">
                  {usd2(d.solicitado)}
                </td>
                <td className="tabular px-3 py-1.5 text-right text-blue-700">
                  {usd2(d.neto_recibido_escrow)}
                </td>
                <td className="tabular px-3 py-1.5 text-right text-blue-700">
                  {usd2(d.trasladado_operativa)}
                </td>
                <td className="tabular px-3 py-1.5 text-right font-medium text-blue-700">
                  {usd2(num(d.neto_recibido_escrow) - num(d.trasladado_operativa))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// Convierte las filas planas en una secuencia con subtotales por Disbursement.
type RenderItem =
  | { t: "row"; r: LedgerSheetRow }
  | { t: "section"; r: LedgerSheetRow }
  | { t: "subtotal"; gid: number; key: string; amount: number; paid: number; due: number };

// Clave única de fila (reflejo = línea; histórico = fila del espejo).
const rowKey = (r: LedgerSheetRow) => (r.line_id != null ? `l${r.line_id}` : `s${r.id}`);

// Quita encabezados de sección que no tienen filas de datos debajo
// (ej. Unrecorded Center / Estimates & Quotes / Service Done, vacías en el Excel).
function dropEmptySections(body: LedgerSheetRow[]): LedgerSheetRow[] {
  const out: LedgerSheetRow[] = [];
  for (let i = 0; i < body.length; i++) {
    const r = body[i];
    if (r.kind === "section") {
      let hasData = false;
      for (let j = i + 1; j < body.length && body[j].kind !== "section"; j++) {
        if (body[j].kind === "data") {
          hasData = true;
          break;
        }
      }
      if (!hasData) continue;
    }
    out.push(r);
  }
  return out;
}

// Gran total — se muestra arriba (en el encabezado) y abajo.
function GrandTotalRow({ amount, paid, due }: { amount: number; paid: number; due: number }) {
  return (
    <tr className="border-t-4 border-double border-slate-500 bg-slate-800 text-sm font-bold normal-case text-white">
      <td colSpan={6} className="px-2 py-1.5 text-right">
        GRAND TOTAL
      </td>
      <td className="tabular px-2 py-1.5 text-right">{usd2(amount)}</td>
      <td className="tabular px-2 py-1.5 text-right">{usd2(paid)}</td>
      <td className="tabular px-2 py-1.5 text-right">{usd2(due)}</td>
      <td colSpan={7} />
    </tr>
  );
}

// Lo más reciente arriba: invierte el orden de los BLOQUES por Disbursement,
// dejando cada bloque con sus líneas en orden y los encabezados de sección donde
// estaban (el Excel va del más viejo al más nuevo; acá se abre por el mes en curso).
function newestFirst(body: LedgerSheetRow[]): LedgerSheetRow[] {
  const out: LedgerSheetRow[] = [];
  let groups: LedgerSheetRow[][] = [];
  let cur: LedgerSheetRow[] | null = null;
  const flush = () => {
    if (cur) {
      groups.push(cur);
      cur = null;
    }
    for (const g of groups.reverse()) out.push(...g);
    groups = [];
  };
  for (const r of body) {
    if (r.kind === "section") {
      flush();
      out.push(r);
      continue;
    }
    if (!cur || (cur[0].payee ?? "") !== (r.payee ?? "")) {
      if (cur) groups.push(cur);
      cur = [r];
    } else {
      cur.push(r);
    }
  }
  flush();
  return out;
}

// Subtotales por Disbursement usando el Amount Paid EN VIVO (paidOf lee lo editado).
function withSubtotals(
  body: LedgerSheetRow[],
  paidOf: (r: LedgerSheetRow) => number,
): RenderItem[] {
  const items: RenderItem[] = [];
  let gid = 0;
  let g: { key: string; amount: number; paid: number; due: number; count: number } | null = null;
  const flush = () => {
    if (g && g.count > 0) {
      items.push({
        t: "subtotal",
        gid: gid++,
        key: g.key,
        amount: g.amount,
        paid: g.paid,
        due: g.due,
      });
    }
    g = null;
  };
  for (const r of body) {
    if (r.kind === "section") {
      flush();
      items.push({ t: "section", r });
      continue;
    }
    const key = r.payee ?? "—";
    if (!g || g.key !== key) {
      flush();
      g = { key, amount: 0, paid: 0, due: 0, count: 0 };
    }
    const paid = paidOf(r);
    g.amount += num(r.amount);
    g.paid += paid;
    g.due += num(r.amount) - paid;
    g.count += 1;
    items.push({ t: "row", r });
  }
  flush();
  return items;
}

// Panel de pagos en cuotas: crear un pago (total) y ver total/asignado/pendiente.
function PaymentsPanel({ payments }: { payments: LedgerPayment[] }) {
  const create = useCreatePayment();
  const [label, setLabel] = useState("");
  const [total, setTotal] = useState("");
  const INP = "rounded border border-slate-300 px-2 py-1 text-sm";

  return (
    <details className="rounded-lg border border-slate-200 bg-white" open={payments.length > 0}>
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
        Installment payments ({payments.length}) — one payment split across several Disbursements
      </summary>
      <div className="space-y-3 border-t border-slate-200 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <input
            className={`${INP} flex-1`}
            placeholder="Payment name (e.g. Legal Invoice #123)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <input
            type="number"
            className={`${INP} w-32`}
            placeholder="Total $"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
          <button
            type="button"
            disabled={!label.trim() || !total || create.isPending}
            onClick={() =>
              create.mutate(
                { label: label.trim(), total_amount: Number(total) },
                {
                  onSuccess: () => {
                    setLabel("");
                    setTotal("");
                  },
                },
              )
            }
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Create payment
          </button>
        </div>
        {payments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Payment</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Allocated (installments)</th>
                  <th className="px-3 py-2 text-right">Pending</th>
                  <th className="px-3 py-2 text-center">Installments</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-1.5 font-medium">{p.label}</td>
                    <td className="tabular px-3 py-1.5 text-right">{usd2(p.total_amount)}</td>
                    <td className="tabular px-3 py-1.5 text-right text-blue-700">
                      {usd2(p.allocated)}
                    </td>
                    <td
                      className={`tabular px-3 py-1.5 text-right font-medium ${
                        num(p.remaining) > 0 ? "text-amber-700" : "text-emerald-700"
                      }`}
                    >
                      {usd2(p.remaining)}
                    </td>
                    <td className="px-3 py-1.5 text-center text-slate-500">{p.installments}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-400">
            Create a payment with its total; then, on each LEDGER row, pick that payment in the
            "Payment" column to link the installment. The pending amount adjusts automatically.
          </p>
        )}
      </div>
    </details>
  );
}

// Celda de texto editable (proveedor, fecha, descripción, etc.). Guarda al salir.
// Ancho por columna: los textos largos (Payee "Disbursement #26 - 08/01/2026",
// Descripción, # de factura de 20 dígitos) no pueden salir cortados.
const CELL_W = {
  sm: "w-20",
  date: "w-28", // "2026-07-16 00:00:00" del Excel
  md: "w-36", // consecutivo de factura (20 dígitos)
  lg: "w-52", // "Disbursement #26 - 08/01/2026"
  xl: "w-[22rem]", // descripciones largas del Excel
} as const;

function EditCell({
  value,
  onSave,
  size = "sm",
}: {
  value: string | null;
  onSave: (v: string) => void;
  size?: keyof typeof CELL_W;
}) {
  const [v, setV] = useState(value ?? "");
  return (
    <td className="px-1 py-0.5">
      <input
        // El tooltip muestra el contenido completo aunque el ancho no alcance.
        title={v || undefined}
        className={`${CELL_W[size]} rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] text-slate-600`}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== (value ?? "") && onSave(v)}
      />
    </td>
  );
}

type TextField =
  | "entry_date"
  | "invoice_no"
  | "payee"
  | "description"
  | "paid_total"
  | "date_paid"
  | "payment_info"
  | "bank_paid_from"
  | "request"
  | "notes";

// Fila EDITABLE del LEDGER (histórico y reflejo): Cost Code (→ Account auto) y
// Amount Paid (→ varianza). El destino de la edición depende del origen:
// reflejo = línea del Short Payment; histórico = fila del espejo.
function LedgerRow({
  r,
  wbs,
  payments,
  paid,
  onPaidChange,
}: {
  r: LedgerSheetRow;
  wbs: Wbs[];
  payments: LedgerPayment[];
  paid: string;
  onPaidChange: (v: string) => void;
}) {
  const updLine = useUpdateLedgerLine();
  const updSheet = useUpdateLedgerSheetRow();
  const [code, setCode] = useState(r.cost_code ?? "");
  const [pay, setPay] = useState(r.payment_label ?? "");

  const savePayment = () => {
    if (r.id == null || pay.trim() === (r.payment_label ?? "")) return;
    if (pay.trim() === "") {
      updSheet.mutate({ rowId: r.id, payment_id: 0 }); // desligar
      return;
    }
    const p = payments.find((x) => x.label === pay.trim());
    if (!p) {
      setPay(r.payment_label ?? ""); // no existe ese pago → revertir
      return;
    }
    updSheet.mutate({ rowId: r.id, payment_id: p.id });
  };

  const savePaid = () => {
    if (String(paid) === (r.amount_paid ?? "")) return;
    const amount_paid = num(paid);
    if (r.line_id != null) updLine.mutate({ lineId: r.line_id, amount_paid });
    else if (r.id != null) updSheet.mutate({ rowId: r.id, amount_paid });
  };
  const saveCode = () => {
    if (code.trim() === (r.cost_code ?? "")) return;
    const w = wbs.find((x) => x.wbs_code === code.trim());
    if (!w) {
      setCode(r.cost_code ?? ""); // no existe ese WBS → revertir
      return;
    }
    if (r.line_id != null) updLine.mutate({ lineId: r.line_id, wbs_id: w.id });
    else if (r.id != null) updSheet.mutate({ rowId: r.id, wbs_id: w.id });
  };

  const saveText = (field: TextField, v: string) => {
    if (r.id != null) updSheet.mutate({ rowId: r.id, [field]: v });
  };

  const due = num(r.amount) - num(String(paid));
  const isReflect = r.line_id != null;
  return (
    <tr className={isReflect ? "bg-emerald-50/40 hover:bg-emerald-50" : "hover:bg-blue-50/40"}>
      {/* Cost Code editable (elegís el # de proyecto) → Account automático */}
      <td className="px-1 py-0.5">
        <input
          list="wbs-codes"
          className="w-16 rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] font-medium text-blue-700"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onBlur={saveCode}
        />
      </td>
      <td className="min-w-[13rem] px-2 py-1 text-slate-700" title={r.account ?? ""}>
        {r.account ?? ""}
      </td>
      <EditCell value={r.entry_date} onSave={(v) => saveText("entry_date", v)} size="date" />
      <EditCell value={r.invoice_no} onSave={(v) => saveText("invoice_no", v)} size="md" />
      <EditCell value={r.payee} onSave={(v) => saveText("payee", v)} size="lg" />
      <EditCell value={r.description} onSave={(v) => saveText("description", v)} size="xl" />
      <td className="tabular px-2 py-1 text-right text-blue-700">{usd2(r.amount)}</td>
      {/* Amount Paid editable con formato $ (recalcula varianza y subtotal en vivo).
          Input NO controlado: muestra $1,234.56 en reposo y el número crudo al editar. */}
      <td className="px-1 py-0.5 text-right">
        <input
          key={r.amount_paid ?? ""}
          type="text"
          inputMode="decimal"
          className="tabular w-20 rounded border border-emerald-400 bg-white px-1 py-0.5 text-right text-[11px] text-emerald-800"
          defaultValue={usd2(paid)}
          onFocus={(e) => {
            e.currentTarget.value = e.currentTarget.value.replace(/[^0-9.-]/g, "");
            e.currentTarget.select();
          }}
          onChange={(e) => onPaidChange(e.currentTarget.value.replace(/[^0-9.-]/g, ""))}
          onBlur={(e) => {
            savePaid();
            e.currentTarget.value = usd2(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = usd2(paid);
              e.currentTarget.blur();
            }
          }}
        />
      </td>
      {/* Amount Due = varianza, en vivo */}
      <td
        className={`tabular px-2 py-1 text-right font-medium ${
          due > 0 ? "text-amber-700" : "text-slate-400"
        }`}
      >
        {usd2(due)}
      </td>
      <EditCell value={r.paid_total} onSave={(v) => saveText("paid_total", v)} />
      <EditCell value={r.date_paid} onSave={(v) => saveText("date_paid", v)} size="date" />
      <EditCell value={r.payment_info} onSave={(v) => saveText("payment_info", v)} size="lg" />
      <EditCell value={r.bank_paid_from} onSave={(v) => saveText("bank_paid_from", v)} size="lg" />
      <EditCell value={r.request} onSave={(v) => saveText("request", v)} />
      <EditCell value={r.notes} onSave={(v) => saveText("notes", v)} size="md" />
      {/* Pago en cuotas: ligar esta fila a un pago (o dejar vacío) */}
      <td className="px-1 py-0.5">
        <input
          list="payment-labels"
          className="w-24 rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px]"
          placeholder="—"
          value={pay}
          onChange={(e) => setPay(e.target.value)}
          onBlur={savePayment}
        />
      </td>
    </tr>
  );
}

export function LedgerView() {
  const sheet = useLedgerSheet();
  const wbs = useWbsList().data ?? [];
  const payments = useLedgerPayments().data ?? [];
  const all = sheet.data ?? [];
  const meta = all.filter((r) => r.kind === "meta");
  const body = all.filter((r) => r.kind !== "meta");
  const project = meta.find((m) => m.cost_code === "Project:")?.account;
  const address = meta.find((m) => m.cost_code === "Address:")?.account;

  const importDisb = useImportDisbursement();
  const deploy = useDeployToJobCost();
  const [disbNo, setDisbNo] = useState("");
  // Filtro rápido por N° de proyecto (Cost Code) — también matchea cuenta/proveedor.
  const [filter, setFilter] = useState("");
  // Lo más reciente primero (por defecto): abrir el Ledger en el mes en curso.
  const [newest, setNewest] = useState(true);

  // Amount Paid en vivo: lo editado (edits) o el valor del servidor.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const paidStr = (r: LedgerSheetRow): string => {
    const k = rowKey(r);
    return edits[k] !== undefined ? edits[k] : (r.amount_paid ?? "");
  };
  const paidNum = (r: LedgerSheetRow) => num(paidStr(r));

  // Aplica el filtro por N° de proyecto: conserva secciones (dropEmptySections
  // limpia las que quedan sin filas) y filtra las filas de datos por cost_code,
  // cuenta, proveedor o descripción.
  const q = filter.trim().toLowerCase();
  const fbody =
    q === ""
      ? body
      : body.filter(
          (r) =>
            r.kind !== "data" ||
            [r.cost_code, r.account, r.payee, r.description].some((v) =>
              String(v ?? "")
                .toLowerCase()
                .includes(q),
            ),
        );

  const items = withSubtotals(dropEmptySections(newest ? newestFirst(fbody) : fbody), paidNum);
  const grand = fbody
    .filter((r) => r.kind === "data")
    .reduce(
      (a, r) => {
        const paid = paidNum(r);
        return {
          amount: a.amount + num(r.amount),
          paid: a.paid + paid,
          due: a.due + (num(r.amount) - paid),
        };
      },
      { amount: 0, paid: 0, due: 0 },
    );

  return (
    <div className="space-y-4">
      {/* Catálogos compartidos: WBS (Cost Code) y pagos en cuotas (columna Pago) */}
      <datalist id="payment-labels">
        {payments.map((p) => (
          <option key={p.id} value={p.label} />
        ))}
      </datalist>
      <datalist id="wbs-codes">
        {wbs.map((w) => (
          <option key={w.id} value={w.wbs_code}>
            {w.title}
          </option>
        ))}
      </datalist>

      {/* Barra: importar un Short Payment por # de Disbursement + recalcular */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600" htmlFor="disb-no">
            Update LEDGER — Disbursement #
          </label>
          <input
            id="disb-no"
            type="number"
            placeholder="e.g. 12"
            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
            value={disbNo}
            onChange={(e) => setDisbNo(e.target.value)}
          />
          <button
            type="button"
            disabled={!disbNo || importDisb.isPending}
            onClick={async () => {
              const res = await importDisb.mutateAsync(Number(disbNo));
              setEdits({});
              const parts = [
                `${res.imported} new line${res.imported === 1 ? "" : "s"}`,
                res.updated
                  ? `${res.updated} refreshed (Cost Code, Amount Paid and invoices kept)`
                  : "",
                res.removed ? `${res.removed} removed (no longer in the Short Payment)` : "",
              ].filter(Boolean);
              alert(
                `Short Payment #${res.disb_no} → Ledger: ${parts.join(" · ")}.\nAssign any missing Cost Codes (WBS), then click «Deploy to Job Cost».`,
              );
            }}
            className="rounded border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {importDisb.isPending ? "Bringing in…" : "Bring in Short Payment payments"}
          </button>
          <button
            type="button"
            disabled={!disbNo || deploy.isPending}
            title="Places each WBS in the 3rd week of the month in the Job Cost. Warns if the month already has amounts."
            onClick={async () => {
              const res = await deploy.mutateAsync(Number(disbNo));
              if (res.conflicts.length > 0) {
                const lines = res.conflicts
                  .map(
                    (c) =>
                      `• ${c.wbs_code}: already has $${Number(c.total).toLocaleString()} in the month`,
                  )
                  .join("\n");
                alert(
                  `⚠ Nothing was deployed. These projects already have an amount in that month:\n\n${lines}\n\nMove those amounts forward in the Job Cost and click «Deploy» again.`,
                );
              } else if (res.placed > 0) {
                alert(
                  `✓ Deployed ${res.placed} amounts to the Job Cost, in the 3rd week of the month (${res.week}).`,
                );
              } else {
                alert(res.message ?? "There were no rows with a WBS to deploy.");
              }
            }}
            className="rounded border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {deploy.isPending ? "Deploying…" : "Deploy to Job Cost"}
          </button>
          {(importDisb.error ?? deploy.error) instanceof ApiError ? (
            <span className="text-sm text-red-600">
              {((importDisb.error ?? deploy.error) as ApiError).problem.detail ??
                ((importDisb.error ?? deploy.error) as ApiError).problem.title}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            setEdits({});
            sheet.refetch();
          }}
          disabled={sheet.isFetching}
          className="shrink-0 rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {sheet.isFetching ? "Recalculating…" : "🔄 Recalculate"}
        </button>
      </div>

      {(project || address) && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm">
          {project ? (
            <p>
              <span className="text-slate-400">Project:</span>{" "}
              <span className="font-medium">{project}</span>
            </p>
          ) : null}
          {address ? (
            <p>
              <span className="text-slate-400">Address:</span> {address}
            </p>
          ) : null}
        </div>
      )}

      <EscrowPanel />
      <PaymentsPanel payments={payments} />

      {/* Filtro rápido por N° de proyecto (Cost Code) */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600" htmlFor="ledger-filter">
          Filter by project #
        </label>
        <input
          id="ledger-filter"
          list="wbs-codes"
          placeholder="e.g. 0.7, or type an account/payee"
          className="w-64 rounded border border-slate-300 px-2 py-1 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="mx-1 h-5 w-px bg-slate-300" />
        <button
          type="button"
          onClick={() => setNewest((v) => !v)}
          title="Order of the Disbursement blocks. The Excel goes oldest → newest; here it opens on the current month."
          className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          {newest ? "↓ Newest first" : "↑ Excel order (oldest first)"}
        </button>
        {filter ? (
          <>
            <button
              type="button"
              onClick={() => setFilter("")}
              className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50"
            >
              Clear
            </button>
            <span className="text-xs text-slate-500">
              {fbody.filter((r) => r.kind === "data").length} rows · Amount {usd2(grand.amount)} ·
              Paid {usd2(grand.paid)}
            </span>
          </>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        {/* Ancho mínimo acorde a las columnas anchas (Payee/Descripción/# factura). */}
        <table className="w-full min-w-[2150px] border-collapse text-[11px]">
          <thead className="sticky top-0 bg-slate-100 text-left uppercase text-slate-500">
            <tr>
              <th className="whitespace-nowrap px-2 py-1">Cost Code</th>
              <th className="whitespace-nowrap px-2 py-1">Account</th>
              <th className="whitespace-nowrap px-2 py-1">Date</th>
              <th className="whitespace-nowrap px-2 py-1">Invoice #</th>
              <th className="whitespace-nowrap px-2 py-1">Payee</th>
              <th className="whitespace-nowrap px-2 py-1">Description</th>
              <th className="px-2 py-1 text-right">Amount</th>
              <th className="px-2 py-1 text-right">Amount Paid</th>
              <th className="px-2 py-1 text-right">Amount Due</th>
              <th className="px-2 py-1">Paid Total</th>
              <th className="px-2 py-1">Date Paid</th>
              <th className="px-2 py-1">Payment Info</th>
              <th className="px-2 py-1">Bank Paid From</th>
              <th className="px-2 py-1">Request</th>
              <th className="px-2 py-1">Notes</th>
              <th className="px-2 py-1">Payment (installment)</th>
            </tr>
            {/* El gran total también arriba, para no bajar hasta el final. */}
            {items.length > 0 ? <GrandTotalRow {...grand} /> : null}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((it) => {
              if (it.t === "section") {
                return (
                  <tr key={`sec-${it.r.id ?? it.r.section}`} className="bg-slate-200/60">
                    <td colSpan={COLS} className="px-2 py-1.5 font-semibold text-slate-700">
                      {it.r.section}
                    </td>
                  </tr>
                );
              }
              if (it.t === "subtotal") {
                return (
                  <tr
                    key={`st-${it.gid}`}
                    className="border-y-2 border-blue-400 bg-blue-100 font-semibold text-blue-900"
                  >
                    <td colSpan={6} className="px-2 py-1.5 text-right">
                      Subtotal {it.key}
                    </td>
                    <td className="tabular px-2 py-1.5 text-right">{usd2(it.amount)}</td>
                    <td className="tabular px-2 py-1.5 text-right">{usd2(it.paid)}</td>
                    <td className="tabular px-2 py-1.5 text-right">{usd2(it.due)}</td>
                    <td colSpan={7} />
                  </tr>
                );
              }
              return (
                <LedgerRow
                  key={it.r.id ?? `l${it.r.line_id}`}
                  r={it.r}
                  wbs={wbs}
                  payments={payments}
                  paid={paidStr(it.r)}
                  onPaidChange={(v) => setEdits((e) => ({ ...e, [rowKey(it.r)]: v }))}
                />
              );
            })}
            {items.length === 0 ? (
              <tr>
                <td colSpan={COLS} className="px-3 py-8 text-center text-slate-400">
                  {sheet.isLoading
                    ? "Loading LEDGER…"
                    : filter
                      ? `No rows match "${filter}".`
                      : "No LEDGER data."}
                </td>
              </tr>
            ) : null}
          </tbody>
          {items.length > 0 ? (
            <tfoot>
              <GrandTotalRow {...grand} />
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
