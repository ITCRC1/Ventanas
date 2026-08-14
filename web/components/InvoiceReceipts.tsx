"use client";

import { ApiError } from "@/lib/api";
import {
  type InvoiceReceipt,
  type LedgerCandidate,
  type MatchSuggestion,
  type OpenShortPayment,
  useAddToShortPayment,
  useApplyMatches,
  useAutomatch,
  useCreateInvoiceReceipt,
  useDeleteInvoiceReceipt,
  useInvoiceReceiptStatus,
  useInvoiceReceipts,
  useJustifyPayment,
  useLinkCandidates,
  useOpenShortPayment,
  useRefFx,
  useSetLinks,
  useSyncInvoiceReceipts,
  useUpdateInvoiceReceipt,
} from "@/lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

const symOf = (cur: string | null) => (cur === "USD" ? "$" : cur === "CRC" ? "₡" : "");

const fmt = (n: number, cur: string | null) => {
  const s = symOf(cur);
  const v = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return s ? `${s}${v}` : `${v} ${cur ?? ""}`.trim();
};

const money = (amount: string | null, currency: string | null) => {
  if (amount == null || amount === "") return <span className="text-slate-300">—</span>;
  const n = Number(amount);
  if (Number.isNaN(n)) return amount;
  return fmt(n, currency || "CRC");
};

const dt = (s: string | null) => (s ? s.slice(0, 10) : "—");

// Nota de crédito resta → signo negativo; el resto positivo.
const sgn = (docType: string | null) => (docType === "NC" ? -1 : 1);
const DOC_LABEL: Record<string, string> = {
  FE: "Factura",
  NC: "Nota Crédito",
  ND: "Nota Débito",
  TE: "Tiquete",
  FEC: "Fact. Compra",
  FEE: "Fact. Export.",
};

// Convierte un monto de la factura a USD: si ya es USD tal cual; si es ₡ usa el TC.
const toUsd = (total: string | null, currency: string | null, ref: number | null) => {
  if (total == null || total === "") return null;
  const n = Number(total);
  if (Number.isNaN(n)) return null;
  if ((currency || "CRC") === "USD") return n;
  if (ref && ref > 0) return n / ref;
  return null;
};
const usd = (n: number | null) =>
  n == null
    ? "—"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Nombre corto de la tanda abierta: "#26 · August 2026".
const spTitle = (b: OpenShortPayment) => {
  const d = new Date(`${b.send_date ?? b.period_month}T00:00:00`);
  const m = d.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
  return `#${b.disb_no} · ${m}`;
};

// Celda "Short Payment": manda la factura como última línea de la tanda abierta,
// o muestra en cuál quedó si ya se envió.
function ShortPaymentCell({
  r,
  open,
  refFx,
}: {
  r: InvoiceReceipt;
  open: OpenShortPayment | null | undefined;
  refFx: number | null;
}) {
  const add = useAddToShortPayment();
  const needsFx = (r.currency || "CRC") !== "USD" && !(refFx && refFx > 0);

  if (r.sp_line_no != null) {
    return (
      <span
        className="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] font-medium text-indigo-800"
        title={`Line ${r.sp_line_no} of Disbursement #${r.sp_disb_no}.${r.sp_disb_sub}${
          r.sp_amount ? ` — ${usd(Number(r.sp_amount))}` : ""
        }`}
      >
        ✓ SP #{r.sp_disb_no} · L{r.sp_line_no}
      </span>
    );
  }

  const send = () =>
    add.mutate(
      { rid: r.id, ref_fx: refFx, force: false },
      {
        onSuccess: (res) =>
          alert(
            `✓ Added to Disbursement #${res.disb_no}.${res.disb_sub} as line ${res.line_no}\n` +
              `${res.description}\n${usd(Number(res.amount_usd))} — invoice ${res.invoice_total}`,
          ),
        onError: (err) =>
          alert(
            err instanceof ApiError
              ? (err.problem.detail ?? err.problem.title)
              : "Could not add it to the Short Payment.",
          ),
      },
    );

  return (
    <button
      type="button"
      disabled={!open || add.isPending || needsFx || r.total == null}
      onClick={send}
      title={
        !open
          ? "No open Short Payment — create the month's batch in Disbursements"
          : needsFx
            ? "Set the reference rate (₡ per US$) above to convert this invoice"
            : r.total == null
              ? "The invoice has no amount"
              : `Add as the last line of Short Payment ${spTitle(open)} — amount = total incl. tax`
      }
      className="rounded border border-indigo-500 px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-40"
    >
      {add.isPending ? "Adding…" : `＋ SP ${open ? `#${open.disb_no}` : ""}`}
    </button>
  );
}

// Panel modal: marcar con check los desembolsos que cubre esta factura.
function AssociateModal({
  receipt,
  onClose,
}: {
  receipt: InvoiceReceipt;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false);
  const cand = useLinkCandidates(receipt.id, q, showAll, true);
  const setLinks = useSetLinks();
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(receipt.links.map((l) => l.ledger_entry_id)),
  );

  const invCur = receipt.currency || "CRC";
  const sg = sgn(receipt.doc_type);
  const isNC = receipt.doc_type === "NC";
  const invTotal = Number(receipt.total ?? 0) * sg;

  // Datos de monto de todo lo que podamos ver (links actuales + candidatos).
  const info = useMemo(() => {
    const m = new Map<number, { amount: number; usd: number; cur: string | null }>();
    for (const l of receipt.links)
      m.set(l.ledger_entry_id, {
        amount: Number(l.amount ?? 0),
        usd: Number(l.amount_usd ?? 0),
        cur: l.currency,
      });
    for (const c of cand.data ?? [])
      m.set(c.id, {
        amount: Number(c.amount ?? 0),
        usd: Number(c.amount_usd ?? 0),
        cur: c.currency,
      });
    return m;
  }, [receipt.links, cand.data]);

  let sumUsd = 0;
  let sumSameCur = 0;
  for (const id of selected) {
    const x = info.get(id);
    if (!x) continue;
    sumUsd += x.usd;
    if (x.cur === invCur) sumSameCur += x.amount;
  }
  const diff = invTotal - sumSameCur;
  const matches = invTotal > 0 && Math.abs(diff) < 0.01;

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rows = cand.data ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl">
        {/* Cabecera */}
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              Link disbursements to this invoice
              {receipt.doc_type ? (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${isNC ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-700"}`}
                >
                  {DOC_LABEL[receipt.doc_type] ?? receipt.doc_type}
                </span>
              ) : null}
            </div>
            <div className="text-xs text-slate-500">
              {receipt.issuer_name || receipt.email_from || "Invoice"} · #
              {receipt.invoice_no || "—"} ·{" "}
              <b className={isNC ? "text-red-600" : undefined}>{fmt(invTotal, invCur)}</b>
            </div>
            {isNC ? (
              <div className="mt-1 rounded bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">
                ⚠ Credit note — this <b>subtracts</b>. Link it to the same disbursement as its
                invoice so the net effect is what you expect.
              </div>
            ) : (
              <div className="mt-0.5 text-[11px] text-slate-400">
                Check every ledger entry (disbursement) this invoice covers — it can be several.
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        {/* Búsqueda */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter: payee, description, amount, entry #…"
            className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
          />
          <label className="flex items-center gap-1 text-[11px] text-slate-600">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            Show all (incl. already invoiced)
          </label>
        </div>

        {/* Lista con checkboxes */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-100 text-left text-slate-500">
              <tr>
                <th className="w-8 px-2 py-1" />
                <th className="px-2 py-1">Date</th>
                <th className="px-2 py-1">Payee / description</th>
                <th className="px-2 py-1">Invoice #</th>
                <th className="px-2 py-1 text-right">Amount</th>
                <th className="px-2 py-1 text-right">USD</th>
                <th className="px-2 py-1">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c: LedgerCandidate) => {
                const on = selected.has(c.id);
                const busy = c.linked_other && !c.linked_here;
                return (
                  <tr
                    key={c.id}
                    className={`${on ? "bg-teal-50" : ""} ${busy ? "opacity-50" : "hover:bg-slate-50"}`}
                  >
                    <td className="px-2 py-1 text-center">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(c.id)}
                        title={busy ? "Already linked to another invoice" : ""}
                      />
                    </td>
                    <td className="px-2 py-1 text-slate-500">{dt(c.entry_date)}</td>
                    <td className="px-2 py-1 text-slate-700">
                      <span className="font-medium">#{c.id}</span> ·{" "}
                      {c.payee_name || c.description || "—"}
                      {busy ? (
                        <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">
                          invoiced
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1 text-slate-500">{c.invoice_no || "—"}</td>
                    <td className="tabular px-2 py-1 text-right">{money(c.amount, c.currency)}</td>
                    <td className="tabular px-2 py-1 text-right text-slate-500">
                      {c.amount_usd ? `$${Number(c.amount_usd).toLocaleString()}` : "—"}
                    </td>
                    <td className="px-2 py-1 text-slate-500">{c.status}</td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-slate-400">
                    {cand.isLoading ? "Loading…" : "No matching disbursements."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {/* Pie: reconciliación + guardar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <div className="text-xs text-slate-600">
            <span className="mr-3">
              Invoice: <b>{fmt(invTotal, invCur)}</b>
            </span>
            <span className="mr-3">
              Selected: <b>{selected.size}</b>
            </span>
            <span className="mr-3">
              Σ same currency ({invCur}): <b>{fmt(sumSameCur, invCur)}</b>
            </span>
            <span className="mr-3 text-slate-400">Σ USD: ${sumUsd.toLocaleString()}</span>
            {invTotal > 0 ? (
              matches ? (
                <span className="rounded bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                  ✓ Matches invoice
                </span>
              ) : (
                <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
                  Diff: {fmt(diff, invCur)}
                </span>
              )
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={setLinks.isPending}
              onClick={() =>
                setLinks.mutate(
                  { rid: receipt.id, ledger_entry_ids: [...selected] },
                  { onSuccess: onClose },
                )
              }
              className="rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {setLinks.isPending ? "Saving…" : `Save (${selected.size})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Modal de auto-match: propone cruces, pre-marca los obvios ('auto'), deja los
// dudosos ('review') sin marcar; aplica los seleccionados como si fuera manual.
function AutoMatchModal({
  suggestions,
  onClose,
}: {
  suggestions: MatchSuggestion[];
  onClose: () => void;
}) {
  const apply = useApplyMatches();
  const [sel, setSel] = useState<Set<number>>(
    () => new Set(suggestions.filter((s) => s.tier === "auto").map((s) => s.receipt_id)),
  );
  const [done, setDone] = useState<{ applied: number; skipped: number } | null>(null);
  const auto = suggestions.filter((s) => s.tier === "auto");
  const review = suggestions.filter((s) => s.tier === "review");
  const toggle = (id: number) =>
    setSel((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const row = (s: MatchSuggestion) => (
    <tr key={s.receipt_id} className={sel.has(s.receipt_id) ? "bg-teal-50" : "hover:bg-slate-50"}>
      <td className="px-2 py-1 text-center">
        <input
          type="checkbox"
          checked={sel.has(s.receipt_id)}
          onChange={() => toggle(s.receipt_id)}
        />
      </td>
      <td className="px-2 py-1">
        <div className="font-medium text-slate-700">{s.issuer_name || "?"}</div>
        <div className="text-[10px] text-slate-400">
          #{s.invoice_no || "—"} · {dt(s.invoice_date)} ·{" "}
          {s.invoice_usd != null ? usd(s.invoice_usd) : `${s.invoice_total} ${s.invoice_currency}`}
        </div>
      </td>
      <td className="px-2 py-1 text-slate-400">→</td>
      <td className="px-2 py-1">
        <div className="text-slate-700">
          #{s.ledger_entry_id} {s.ledger_desc || ""}
        </div>
        <div className="text-[10px] text-slate-400">
          {dt(s.ledger_date)} ·{" "}
          {s.ledger_amount_usd ? `$${Number(s.ledger_amount_usd).toLocaleString()}` : "—"}
        </div>
      </td>
      <td className="px-2 py-1">
        {s.reasons.map((r) => (
          <span
            key={r}
            className="mr-1 inline-block rounded bg-slate-100 px-1 text-[10px] text-slate-600"
          >
            {r}
          </span>
        ))}
      </td>
    </tr>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">Auto-match invoices ↔ ledger</div>
            <div className="text-xs text-slate-500">
              {auto.length} clear match{auto.length === 1 ? "" : "es"} (pre-selected) ·{" "}
              {review.length} to review. Matched by amount, payee, invoice #, and date.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        {done ? (
          <div className="p-8 text-center">
            <div className="text-lg font-semibold text-emerald-700">✓ Applied {done.applied}</div>
            {done.skipped > 0 ? (
              <div className="text-xs text-slate-500">{done.skipped} skipped (already taken)</div>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="mt-4 rounded bg-slate-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-auto">
              {suggestions.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-400">
                  No matches found. Set the reference rate for ₡ invoices, or associate manually.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-left text-slate-500">
                    <tr>
                      <th className="w-8 px-2 py-1" />
                      <th className="px-2 py-1">Invoice</th>
                      <th />
                      <th className="px-2 py-1">Ledger entry</th>
                      <th className="px-2 py-1">Why</th>
                    </tr>
                  </thead>
                  {auto.length > 0 ? (
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td
                          colSpan={5}
                          className="bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800"
                        >
                          ✓ Clear matches — will apply
                        </td>
                      </tr>
                      {auto.map(row)}
                    </tbody>
                  ) : null}
                  {review.length > 0 ? (
                    <tbody className="divide-y divide-slate-100">
                      <tr>
                        <td
                          colSpan={5}
                          className="bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800"
                        >
                          ⚠ To review — check any you want to apply
                        </td>
                      </tr>
                      {review.map(row)}
                    </tbody>
                  ) : null}
                </table>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
              <span className="text-xs text-slate-500">{sel.size} selected</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={sel.size === 0 || apply.isPending}
                  onClick={() => {
                    const pairs = suggestions
                      .filter((s) => sel.has(s.receipt_id))
                      .map((s) => ({
                        receipt_id: s.receipt_id,
                        ledger_entry_id: s.ledger_entry_id,
                      }));
                    apply.mutate(pairs, { onSuccess: (r) => setDone(r) });
                  }}
                  className="rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                >
                  {apply.isPending ? "Applying…" : `Apply selected (${sel.size})`}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Modal: justificar una salida de dinero SIN factura (intereses, gobierno…).
function JustifyModal({ onClose }: { onClose: () => void }) {
  const [detail, setDetail] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const cand = useLinkCandidates(0, q, false, true); // rid=0 → solo desembolsos libres
  const justify = useJustifyPayment();
  const rows = cand.data ?? [];
  const sumUsd = rows
    .filter((c) => sel.has(c.id))
    .reduce((s, c) => s + Number(c.amount_usd ?? 0), 0);
  const toggle = (id: number) =>
    setSel((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">
              Justify a payment without invoice
            </div>
            <div className="text-xs text-slate-500">
              For real payments with no invoice (loan interest, government fees, bank charges).
              Write the detail and pick the disbursement(s) it covers.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-slate-400 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-slate-100 px-4 py-3">
          <label className="text-xs font-medium text-slate-600">
            Detail (the justification document)
            <input
              // biome-ignore lint/a11y/noAutofocus: enfocar el detalle al abrir
              autoFocus
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="e.g. Loan interest payment — July 2026 · Bank X"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find disbursement: payee, description, amount, #…"
            className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
          />
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-100 text-left text-slate-500">
              <tr>
                <th className="w-8 px-2 py-1" />
                <th className="px-2 py-1">Date</th>
                <th className="px-2 py-1">Payee / description</th>
                <th className="px-2 py-1 text-right">Amount</th>
                <th className="px-2 py-1 text-right">USD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c: LedgerCandidate) => (
                <tr key={c.id} className={sel.has(c.id) ? "bg-teal-50" : "hover:bg-slate-50"}>
                  <td className="px-2 py-1 text-center">
                    <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
                  </td>
                  <td className="px-2 py-1 text-slate-500">{dt(c.entry_date)}</td>
                  <td className="px-2 py-1 text-slate-700">
                    <span className="font-medium">#{c.id}</span> ·{" "}
                    {c.payee_name || c.description || "—"}
                  </td>
                  <td className="tabular px-2 py-1 text-right">{money(c.amount, c.currency)}</td>
                  <td className="tabular px-2 py-1 text-right text-slate-500">
                    {c.amount_usd ? `$${Number(c.amount_usd).toLocaleString()}` : "—"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                    {cand.isLoading ? "Loading…" : "No free disbursements."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <span className="text-xs text-slate-600">
            {sel.size} selected · <b>${sumUsd.toLocaleString()}</b>
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!detail.trim() || sel.size === 0 || justify.isPending}
              onClick={() =>
                justify.mutate(
                  { detail: detail.trim(), ledger_entry_ids: [...sel] },
                  { onSuccess: onClose },
                )
              }
              className="rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {justify.isPending ? "Applying…" : "Justify & apply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InvoiceReceipts() {
  const list = useInvoiceReceipts();
  const status = useInvoiceReceiptStatus();
  const sync = useSyncInvoiceReceipts();
  const update = useUpdateInvoiceReceipt();
  const del = useDeleteInvoiceReceipt();
  const create = useCreateInvoiceReceipt();
  const automatch = useAutomatch();
  const openSp = useOpenShortPayment();
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<InvoiceReceipt | null>(null);
  const [matchSug, setMatchSug] = useState<MatchSuggestion[] | null>(null);
  const [justifyOpen, setJustifyOpen] = useState(false);
  // TC de referencia (₡/US$) — guardado en la BASE: el mismo para todos los
  // usuarios y en todos los tabs (antes vivía en cada navegador).
  const ref = useRefFx();
  const [refStr, setRefStr] = useState("");
  useEffect(() => {
    if (ref.value != null) setRefStr(String(ref.value));
  }, [ref.value]);
  const refFx = refStr ? Number(refStr) : null;
  // Ocultar las ya asociadas al ledger (pasan a Invoices Applied) y las ignoradas.
  const [showAssociated, setShowAssociated] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);

  const qc = useQueryClient();

  // alta manual
  const [mNo, setMNo] = useState("");
  const [mIssuer, setMIssuer] = useState("");
  const [mTotal, setMTotal] = useState("");

  const all = list.data ?? [];
  const associatedCount = all.filter((r) => r.links.length > 0).length;
  const ignoredCount = all.filter((r) => r.status === "ignored").length;
  const rows = all.filter((r) => {
    if (!showIgnored && r.status === "ignored") return false;
    if (!showAssociated && r.links.length > 0) return false;
    return true;
  });
  const st = status.data;

  // El sync corre en el servidor: el botón solo lo dispara y la pantalla sigue
  // libre. El avance y el resultado llegan por /status.
  const runSync = (full = false) => {
    setSyncMsg(null);
    sync.mutate(full, {
      onSuccess: (r) =>
        setSyncMsg(
          !r.configured
            ? "Mailbox not configured."
            : r.already_running
              ? "A sync is already running…"
              : full
                ? "Full scan started — it keeps running even if you leave this tab."
                : "Sync started…",
        ),
      // El motivo real a la vista: antes solo decía "no se pudo" y había que
      // adivinar (sesión vencida, permiso, backend caído…).
      onError: (err) =>
        setSyncMsg(
          err instanceof ApiError
            ? `Could not start the sync — ${err.problem.detail ?? err.problem.title}`
            : "Could not start the sync — no answer from the server. Reload and sign in again.",
        ),
      onSettled: () => {
        // Refresca el estado ya: el botón pasa a "Syncing…" sin esperar el poll.
        qc.invalidateQueries({ queryKey: ["invoice-receipts", "status"] });
      },
    });
  };
  // Resultado de la última corrida (mientras no se dispare otra).
  const running = st?.sync_running ?? false;
  const lastRun = st?.sync_last;

  return (
    <div className="space-y-4">
      {editing ? <AssociateModal receipt={editing} onClose={() => setEditing(null)} /> : null}
      {matchSug ? (
        <AutoMatchModal suggestions={matchSug} onClose={() => setMatchSug(null)} />
      ) : null}
      {justifyOpen ? <JustifyModal onClose={() => setJustifyOpen(false)} /> : null}

      {/* Estado de conexión + sync */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-teal-700">Invoice inbox</div>
          <div className="text-sm font-semibold text-teal-900">
            {st?.configured ? (
              <>📬 Connected · {st.mailbox}</>
            ) : (
              <span className="text-amber-700">⚠ Not connected yet</span>
            )}
          </div>
          <div className="text-xs text-teal-700">
            {st?.last_sync_at
              ? `Last sync: ${new Date(st.last_sync_at).toLocaleString()}`
              : "New electronic invoices become a line here; associate each to its ledger entry."}
          </div>
          <div className="mt-0.5 text-xs">
            {openSp.data ? (
              <span className="text-indigo-800">
                Open Short Payment: <b>{spTitle(openSp.data)}</b> · {openSp.data.n_lines} lines ·{" "}
                {usd(Number(openSp.data.total_amount))} —{" "}
                <span className="text-indigo-600">“＋ SP” adds the invoice as its last line.</span>
              </span>
            ) : (
              <span className="text-amber-700">
                ⚠ No open Short Payment — create the month's batch in Disbursements to use “＋ SP”.
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {running ? (
            <span className="text-xs text-teal-700">⟳ Reading the mailbox in the background…</span>
          ) : st?.sync_error ? (
            <span className="text-xs text-red-600" title={st.sync_error}>
              ⚠ Last sync failed
            </span>
          ) : lastRun ? (
            <span className="text-xs text-slate-600">
              Last run: {lastRun.inserted} new · {lastRun.skipped} already seen ({lastRun.found}{" "}
              scanned)
            </span>
          ) : null}
          {syncMsg ? <span className="text-xs text-slate-600">{syncMsg}</span> : null}
          <button
            type="button"
            onClick={() => setJustifyOpen(true)}
            className="rounded border border-slate-400 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            title="Justify a real payment that has no invoice (loan interest, government, fees)"
          >
            ＋ No-invoice payment
          </button>
          <button
            type="button"
            disabled={automatch.isPending}
            onClick={() =>
              automatch.mutate(refFx, { onSuccess: (d) => setMatchSug(d.suggestions) })
            }
            className="rounded border border-teal-600 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
            title="Suggest and auto-apply obvious invoice ↔ ledger matches"
          >
            {automatch.isPending ? "Matching…" : "🔎 Auto-match"}
          </button>
          <button
            type="button"
            disabled={sync.isPending || running || !st?.configured}
            onClick={() => runSync(false)}
            className="rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            title={
              st?.configured
                ? "Fetch what arrived since the last sync (a few seconds)"
                : "Configure the mailbox first"
            }
          >
            {running ? "Syncing…" : "⟳ Sync now"}
          </button>
          <button
            type="button"
            disabled={sync.isPending || running || !st?.configured}
            onClick={() => {
              if (
                window.confirm(
                  "Scan the WHOLE mailbox?\n\nIt takes a while — only needed if you suspect an invoice was missed.",
                )
              )
                runSync(true);
            }}
            className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            title="Full scan of the mailbox (slow)"
          >
            ⟳ Full
          </button>
        </div>
      </div>

      {!st?.configured ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <b>To connect the mailbox:</b> on <code>receiptsventanasdev@gmail.com</code> enable 2-Step
          Verification, create an <b>App Password</b>, then set <code>INVOICE_IMAP_USER</code> and{" "}
          <code>INVOICE_IMAP_PASSWORD</code> in the backend (Railway). Manual entry below works
          meanwhile.
        </div>
      ) : null}

      {/* TC de referencia (para mostrar los totales en USD, como el ledger) */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm">
        <span className="font-medium text-amber-800">Reference rate (₡ per US$):</span>
        <input
          type="number"
          value={refStr}
          onChange={(e) => setRefStr(e.target.value)}
          onBlur={() => {
            const v = refStr === "" ? null : Number(refStr);
            if (v !== ref.value) ref.save.mutate(v);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder="e.g. 540"
          title="Saved for everyone (it lives in the database)"
          className="w-28 rounded border border-amber-300 px-2 py-1 text-sm"
        />
        {ref.save.isPending ? <span className="text-[11px] text-amber-700">saving…</span> : null}
        <span className="text-xs text-amber-700">
          Colón invoices are shown in USD at this rate (the ledger is in USD). Shared with the
          Invoices Applied tab.
        </span>
        <span className="mx-1 h-5 w-px bg-amber-300" />
        <label className="flex items-center gap-1 text-xs text-amber-800">
          <input
            type="checkbox"
            checked={showAssociated}
            onChange={(e) => setShowAssociated(e.target.checked)}
          />
          Show associated ({associatedCount})
        </label>
        <label className="flex items-center gap-1 text-xs text-amber-800">
          <input
            type="checkbox"
            checked={showIgnored}
            onChange={(e) => setShowIgnored(e.target.checked)}
          />
          Show ignored ({ignoredCount})
        </label>
        <span className="text-[11px] text-amber-600">
          Associated and ignored invoices are hidden from this queue.
        </span>
      </div>

      {/* Tabla */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1600px] text-xs">
          <thead className="bg-[#0d6b72] text-left uppercase text-white">
            <tr>
              <th className="px-2 py-2">Received</th>
              <th className="px-2 py-2">Issuer</th>
              <th className="px-2 py-2">Invoice #</th>
              <th className="px-2 py-2">Type</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Currency</th>
              <th className="px-2 py-2 text-right">Subtotal</th>
              <th className="px-2 py-2 text-right">Subtotal (USD)</th>
              <th className="px-2 py-2 text-right">Tax (IVA)</th>
              <th className="px-2 py-2 text-right">Tax (USD)</th>
              <th className="px-2 py-2 text-right">Total</th>
              <th className="px-2 py-2 text-right">Total (USD)</th>
              <th className="px-2 py-2 text-center">Files</th>
              <th className="bg-[#8a5a00] px-2 py-2 text-center">Short Payment</th>
              <th className="bg-[#8a5a00] px-2 py-2">Ledger entries (disbursements)</th>
              <th className="bg-[#8a5a00] px-2 py-2">Status</th>
              <th className="bg-[#8a5a00] px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-teal-50/40">
                <td className="px-2 py-1 text-slate-600" title={r.email_subject ?? ""}>
                  {dt(r.received_at)}
                </td>
                <td className="px-2 py-1 text-slate-700">
                  {r.no_invoice ? (
                    <span className="mr-1 rounded bg-slate-700 px-1 text-[10px] font-medium text-white">
                      NO INVOICE
                    </span>
                  ) : null}
                  {r.issuer_name || r.email_from || "—"}
                  {r.issuer_id ? <span className="text-slate-400"> · {r.issuer_id}</span> : null}
                </td>
                <td className="px-2 py-1 font-medium text-slate-800" title={r.clave ?? ""}>
                  {r.invoice_no || "—"}
                </td>
                <td className="px-2 py-1">
                  {r.doc_type ? (
                    <span
                      className={`rounded px-1 text-[10px] font-medium ${r.doc_type === "NC" ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}
                    >
                      {DOC_LABEL[r.doc_type] ?? r.doc_type}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-2 py-1 text-slate-600">{dt(r.invoice_date)}</td>
                <td className="px-2 py-1 text-slate-500">{r.currency || "—"}</td>
                <td
                  className={`tabular px-2 py-1 text-right ${sgn(r.doc_type) < 0 ? "text-red-600" : "text-slate-600"}`}
                >
                  {r.subtotal == null || r.subtotal === "" ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    fmt(Number(r.subtotal) * sgn(r.doc_type), r.currency || "CRC")
                  )}
                </td>
                <td
                  className={`tabular px-2 py-1 text-right ${sgn(r.doc_type) < 0 ? "text-red-600" : "text-teal-700"}`}
                >
                  {usd((toUsd(r.subtotal, r.currency, refFx) ?? 0) * sgn(r.doc_type) || null)}
                </td>
                <td
                  className={`tabular px-2 py-1 text-right ${sgn(r.doc_type) < 0 ? "text-red-600" : "text-slate-600"}`}
                >
                  {r.tax == null || r.tax === "" ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    fmt(Number(r.tax) * sgn(r.doc_type), r.currency || "CRC")
                  )}
                </td>
                <td
                  className={`tabular px-2 py-1 text-right ${sgn(r.doc_type) < 0 ? "text-red-600" : "text-teal-700"}`}
                >
                  {usd((toUsd(r.tax, r.currency, refFx) ?? 0) * sgn(r.doc_type) || null)}
                </td>
                <td
                  className={`tabular px-2 py-1 text-right font-semibold ${sgn(r.doc_type) < 0 ? "text-red-600" : ""}`}
                >
                  {r.total == null || r.total === "" ? (
                    <span className="text-slate-300">—</span>
                  ) : (
                    fmt(Number(r.total) * sgn(r.doc_type), r.currency || "CRC")
                  )}
                </td>
                <td
                  className={`tabular px-2 py-1 text-right font-semibold ${sgn(r.doc_type) < 0 ? "text-red-600" : "text-teal-800"}`}
                >
                  {(() => {
                    const v = toUsd(r.total, r.currency, refFx);
                    return v == null ? (
                      <span
                        className="text-amber-500"
                        title="Set a reference rate above to convert ₡ to USD"
                      >
                        —
                      </span>
                    ) : (
                      usd(v * sgn(r.doc_type))
                    );
                  })()}
                </td>
                <td className="px-2 py-1 text-center">
                  {r.has_pdf_file ? (
                    <a
                      href={`/api/invoice-receipts/${r.id}/file/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="mr-1 rounded bg-red-100 px-1 text-[10px] font-medium text-red-700 hover:bg-red-200"
                      title={r.pdf_filename ?? "Open PDF"}
                    >
                      PDF
                    </a>
                  ) : r.has_pdf ? (
                    <span
                      className="mr-1 rounded bg-red-50 px-1 text-[10px] text-red-400"
                      title="PDF not stored"
                    >
                      PDF
                    </span>
                  ) : null}
                  {r.has_xml_file ? (
                    <a
                      href={`/api/invoice-receipts/${r.id}/file/xml`}
                      className="rounded bg-slate-200 px-1 text-[10px] font-medium text-slate-700 hover:bg-slate-300"
                      title={r.xml_filename ?? "Download XML"}
                    >
                      XML
                    </a>
                  ) : r.xml_filename ? (
                    <span
                      className="rounded bg-slate-100 px-1 text-[10px] text-slate-400"
                      title="XML not stored"
                    >
                      XML
                    </span>
                  ) : null}
                </td>
                <td className="border-l-2 border-slate-200 px-2 py-1 text-center">
                  <ShortPaymentCell r={r} open={openSp.data} refFx={refFx} />
                </td>
                <td className="px-2 py-1">
                  {r.links.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">
                        {r.links.length} disb. · Σ ${r.linked_total_usd.toLocaleString()}
                      </span>
                      {r.links.slice(0, 2).map((l) => (
                        <span
                          key={l.ledger_entry_id}
                          className="rounded bg-slate-100 px-1 text-[10px] text-slate-600"
                          title={l.description ?? ""}
                        >
                          #{l.ledger_entry_id} {l.payee_name || ""}
                        </span>
                      ))}
                      {r.links.length > 2 ? (
                        <span className="text-[10px] text-slate-400">+{r.links.length - 2}</span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setEditing(r)}
                        className="text-[11px] text-teal-700 underline hover:text-teal-900"
                      >
                        Edit
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="rounded border border-teal-500 px-2 py-0.5 text-[11px] font-medium text-teal-700 hover:bg-teal-50"
                    >
                      Associate…
                    </button>
                  )}
                </td>
                <td className="px-2 py-1">
                  <select
                    value={r.status}
                    onChange={(e) => update.mutate({ id: r.id, status: e.target.value })}
                    className="rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                  >
                    <option value="new">New</option>
                    <option value="linked">Linked</option>
                    <option value="ignored">Ignored</option>
                  </select>
                </td>
                <td className="px-2 py-1 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Delete this invoice receipt?")) del.mutate(r.id);
                    }}
                    className="text-red-500 hover:underline"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={17} className="px-3 py-8 text-center text-slate-400">
                  {list.isLoading
                    ? "Loading…"
                    : "No invoices yet. Press “Sync now” or add one manually below."}
                </td>
              </tr>
            ) : null}
          </tbody>
          {/* Alta manual */}
          <tfoot>
            <tr className="border-t-2 border-slate-300 bg-slate-50">
              <td className="px-2 py-1.5 text-[11px] text-slate-500">Add manually →</td>
              <td className="px-2 py-1.5">
                <input
                  value={mIssuer}
                  onChange={(e) => setMIssuer(e.target.value)}
                  placeholder="Issuer"
                  className="w-40 rounded border border-slate-300 px-1 py-0.5 text-[11px]"
                />
              </td>
              <td className="px-2 py-1.5">
                <input
                  value={mNo}
                  onChange={(e) => setMNo(e.target.value)}
                  placeholder="Invoice #"
                  className="w-32 rounded border border-slate-300 px-1 py-0.5 text-[11px]"
                />
              </td>
              <td />
              <td />
              <td />
              <td />
              <td />
              <td />
              <td />
              <td className="px-2 py-1.5 text-right">
                <input
                  value={mTotal}
                  onChange={(e) => setMTotal(e.target.value)}
                  placeholder="0.00"
                  type="number"
                  className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right text-[11px]"
                />
              </td>
              <td colSpan={6} className="px-2 py-1.5">
                <button
                  type="button"
                  disabled={(!mNo.trim() && !mIssuer.trim()) || create.isPending}
                  onClick={() =>
                    create.mutate(
                      {
                        invoice_no: mNo.trim() || null,
                        issuer_name: mIssuer.trim() || null,
                        total: mTotal === "" ? null : Number(mTotal),
                      },
                      {
                        onSuccess: () => {
                          setMNo("");
                          setMIssuer("");
                          setMTotal("");
                        },
                      },
                    )
                  }
                  className="rounded bg-slate-700 px-3 py-1 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  ＋ Add
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
