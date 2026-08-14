"use client";

import { PrintBar } from "@/components/PrintBar";
import {
  type ReconLedgerRow,
  useReconstructedLedger,
  useRefFx,
  useUpdateInvoiceReceipt,
} from "@/lib/hooks";
import { useEffect, useState } from "react";

const dt = (s: string | null) => (s ? s.slice(0, 10) : "—");
const usd = (n: number | null) =>
  n == null
    ? "—"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DOC_LABEL: Record<string, string> = {
  FE: "Factura",
  NC: "Nota Crédito",
  ND: "Nota Débito",
  TE: "Tiquete",
  FEC: "Fact. Compra",
  FEE: "Fact. Export.",
};

// Fila de totales — se usa arriba (dentro del encabezado) y abajo.
function TotalRow({
  n,
  ledger,
  paid,
  due,
  inv,
}: {
  n: number;
  ledger: number;
  paid: number;
  due: number;
  inv: number;
}) {
  return (
    <tr className="border-t-2 border-slate-800 bg-[#C8DCF0] font-bold text-slate-900">
      <td className="border border-slate-300 px-2 py-1.5 normal-case" colSpan={5}>
        TOTAL ({n} lines)
      </td>
      <td className="tabular border border-slate-300 px-2 py-1.5 text-right">{usd(ledger)}</td>
      <td className="tabular border border-slate-300 px-2 py-1.5 text-right">{usd(paid)}</td>
      <td className="tabular border border-slate-300 px-2 py-1.5 text-right">{usd(due)}</td>
      <td className="border border-slate-300" colSpan={3} />
      <td
        className={`tabular border border-slate-300 px-2 py-1.5 text-right ${inv < 0 ? "text-red-600" : ""}`}
      >
        {usd(inv)}
      </td>
      <td className="border border-slate-300" />
    </tr>
  );
}

export function ReconstructedLedger() {
  // TC de referencia compartido (guardado en la base).
  const ref = useRefFx();
  const [refStr, setRefStr] = useState("");
  useEffect(() => {
    if (ref.value != null) setRefStr(String(ref.value));
  }, [ref.value]);
  const refFx = refStr ? Number(refStr) : null;
  const [filter, setFilter] = useState<"all" | "with" | "without">("all");
  // Lo más reciente primero (por defecto).
  const [newest, setNewest] = useState(true);
  const q = useReconstructedLedger(refFx);
  const upd = useUpdateInvoiceReceipt();
  const allRows = q.data?.rows ?? [];
  const withCount = allRows.filter((r) => r.has_invoice).length;
  const withoutCount = allRows.filter((r) => !r.has_invoice).length;
  // Lo más reciente arriba (el servidor las manda en el orden del Excel).
  const ordered = newest ? [...allRows].reverse() : allRows;
  const rows = ordered.filter((r) =>
    filter === "all" ? true : filter === "with" ? r.has_invoice : !r.has_invoice,
  );
  const totals = {
    ledger: rows.reduce((s, r) => s + r.led_usd, 0),
    paid: rows.reduce((s, r) => s + r.led_paid, 0),
    due: rows.reduce((s, r) => s + r.led_due, 0),
    inv: rows.reduce((s, r) => s + (r.inv_usd ?? 0), 0),
  };

  return (
    <div>
      <PrintBar
        title="Ledger with real invoices"
        subtitle={`${rows.length} lines with a document`}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm print:hidden">
        <span className="font-medium text-amber-800">Reference rate (₡ per US$):</span>
        <input
          type="number"
          value={refStr}
          onChange={(e) => setRefStr(e.target.value)}
          onBlur={() => {
            const v = refStr === "" ? null : Number(refStr);
            if (v !== ref.value) ref.save.mutate(v);
          }}
          title="Saved for everyone (it lives in the database)"
          placeholder="e.g. 540"
          className="w-28 rounded border border-amber-300 px-2 py-1 text-sm"
        />
        <span className="mx-1 h-5 w-px bg-amber-300" />
        <button
          type="button"
          onClick={() => setNewest((v) => !v)}
          title="Order of the lines"
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          {newest ? "↓ Newest first" : "↑ Excel order"}
        </button>
        <span className="mx-1 h-5 w-px bg-amber-300" />
        <span className="text-xs text-amber-800">Show:</span>
        {(
          [
            ["all", `All (${allRows.length})`],
            ["with", `With invoice (${withCount})`],
            ["without", `Missing invoice (${withoutCount})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded px-2 py-1 text-xs ${
              filter === k
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="max-h-[74vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1500px] border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#434343] text-left uppercase text-white">
            <tr>
              <th className="border border-slate-600 px-2 py-1">Cost Code</th>
              <th className="border border-slate-600 px-2 py-1">Account</th>
              <th className="border border-slate-600 px-2 py-1">Month</th>
              <th className="border border-slate-600 px-2 py-1">Date</th>
              <th className="border border-slate-600 px-2 py-1">Liquidation</th>
              <th className="border border-slate-600 px-2 py-1 text-right">Amount</th>
              <th className="border border-slate-600 px-2 py-1 text-right">Amount Paid</th>
              <th className="border border-slate-600 px-2 py-1 text-right">Amount Due</th>
              <th className="border border-slate-600 bg-[#8a5a00] px-2 py-1">Type</th>
              <th className="border border-slate-600 bg-[#8a5a00] px-2 py-1">Invoice #</th>
              <th className="border border-slate-600 bg-[#8a5a00] px-2 py-1">Proveedor</th>
              <th className="border border-slate-600 bg-[#8a5a00] px-2 py-1 text-right">
                Invoice USD
              </th>
              <th className="border border-slate-600 bg-[#8a5a00] px-2 py-1">Note</th>
            </tr>
            {/* El total también arriba: no hay que bajar hasta el final para verlo. */}
            {rows.length > 0 ? <TotalRow {...totals} n={rows.length} /> : null}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r: ReconLedgerRow) => {
              const neg = (r.inv_usd ?? 0) < 0;
              return (
                <tr
                  key={`${r.ledger_id}-${r.receipt_id}`}
                  className={r.has_invoice ? "hover:bg-slate-50" : "bg-amber-50 hover:bg-amber-100"}
                >
                  <td className="border border-slate-200 px-2 font-medium text-blue-700">
                    {r.wbs_code || "—"}
                  </td>
                  <td
                    className="border border-slate-200 px-2 text-slate-700"
                    title={r.account ?? ""}
                  >
                    {r.account || "—"}
                  </td>
                  <td className="border border-slate-200 px-2 font-medium text-slate-600">
                    {r.month || (r.entry_date ? r.entry_date.slice(0, 7) : "—")}
                  </td>
                  <td className="border border-slate-200 px-2 text-slate-500">
                    {dt(r.entry_date)}
                  </td>
                  <td className="border border-slate-200 px-2 text-slate-600">
                    {r.payee_name || "—"}
                  </td>
                  <td className="tabular border border-slate-200 px-2 text-right">
                    {usd(r.led_usd)}
                  </td>
                  <td className="tabular border border-slate-200 px-2 text-right text-slate-600">
                    {usd(r.led_paid)}
                  </td>
                  <td
                    className={`tabular border border-slate-200 px-2 text-right ${r.led_due > 0.005 ? "text-amber-700" : "text-slate-400"}`}
                  >
                    {usd(r.led_due)}
                  </td>
                  <td className="border border-slate-200 px-2">
                    {!r.has_invoice ? (
                      <span className="rounded bg-amber-500 px-1 text-[10px] font-medium text-white">
                        MISSING
                      </span>
                    ) : r.no_invoice ? (
                      <span className="rounded bg-slate-700 px-1 text-[10px] text-white">
                        NO INV
                      </span>
                    ) : r.doc_type ? (
                      <span
                        className={`rounded px-1 text-[10px] font-medium ${r.doc_type === "NC" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}
                      >
                        {DOC_LABEL[r.doc_type] ?? r.doc_type}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="border border-slate-200 px-2 font-medium text-slate-800">
                    {r.invoice_no || "—"}
                  </td>
                  <td className="border border-slate-200 px-2 text-slate-700">
                    {r.issuer_name || "—"}
                  </td>
                  <td
                    className={`tabular border border-slate-200 px-2 text-right font-semibold ${neg ? "text-red-600" : "text-teal-800"}`}
                  >
                    {r.inv_usd == null ? "—" : usd(r.inv_usd)}
                  </td>
                  <td className="border border-slate-200 px-1">
                    {r.has_invoice ? (
                      <input
                        key={`n-${r.receipt_id}-${r.note ?? ""}`}
                        defaultValue={r.note ?? ""}
                        placeholder="note…"
                        className="w-36 rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                        onBlur={(e) => {
                          if (r.receipt_id != null && e.target.value !== (r.note ?? ""))
                            upd.mutate({ id: r.receipt_id, notes: e.target.value || null });
                        }}
                      />
                    ) : (
                      <span className="text-[10px] text-amber-600">needs invoice</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-8 text-center text-slate-400">
                  {q.isLoading ? "Loading…" : "No ledger lines. Adjust the filter."}
                </td>
              </tr>
            ) : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot className="sticky bottom-0">
              <TotalRow {...totals} n={rows.length} />
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
