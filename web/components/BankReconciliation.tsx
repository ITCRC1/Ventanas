"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { api } from "@/lib/api";

// --- tipos -------------------------------------------------------------------

interface LogRow {
  id: number;
  tx_date: string;
  txn_no: string | null;
  description: string | null;
  debit: string | number | null;
  credit: string | number | null;
  balance: string | number | null;
  class_code: string | null;
  class_label: string | null;
  recon_status: "matched" | "bank_charge" | "noted" | "unreconciled";
  recon_note: string | null;
  recon_sheet_row_id: number | null;
  ledger_payee: string | null;
  short_payment_no: number | null;
  ledger_cost_code: string | null;
  ledger_amount_paid: string | number | null;
  invoice_no: string | null;
  provider: string | null;
  has_invoice: boolean;
}
interface LogResp {
  account_id: number | null;
  rows: LogRow[];
}
interface Candidate {
  id: number;
  payee: string | null;
  short_payment_no: number | null;
  cost_code: string | null;
  account: string | null;
  amount: string | number | null;
  amount_paid: string | number | null;
  entry_date: string | null;
  inv_no: string | null;
  provider: string | null;
}
interface FeeBlock {
  transfer_fee: string;
  admin_charge: string;
  fx_charge: string;
  interest: string;
  total_charges: string;
  net: string;
}
interface Recap {
  account_id: number | null;
  asof?: string;
  mtd?: FeeBlock;
  ytd?: FeeBlock;
}
interface Proposal {
  tx_id: number;
  tx_date: string;
  tx_description: string | null;
  tx_amount: string;
  sheet_row_id: number;
  ledger_payee: string | null;
  short_payment_no: number | null;
  ledger_amount: string | null;
  invoice_no: string | null;
  provider: string | null;
  score: number;
  tier: "auto" | "review";
  n_candidates: number;
}
interface AutomatchResp {
  auto: Proposal[];
  review: Proposal[];
  pending: number;
}
interface Statement {
  id: number;
  period_from: string | null;
  period_to: string | null;
  filename: string | null;
  source_kind: string;
  opening_balance: string | null;
  closing_balance: string | null;
  n_movements: number;
  n_new: number;
  uploaded_by: string | null;
  uploaded_at: string | null;
}

// --- helpers -----------------------------------------------------------------

const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});
function m2(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "string" ? Number(v) : v;
  if (Number.isNaN(n) || n === 0) return "";
  return n < 0 ? `(${usd2.format(Math.abs(n))})` : usd2.format(n);
}
const STATUS_META: Record<LogRow["recon_status"], { label: string; cls: string }> = {
  matched: { label: "✓ Reconciled", cls: "bg-emerald-100 text-emerald-800" },
  bank_charge: { label: "Bank charge", cls: "bg-slate-100 text-slate-600" },
  noted: { label: "Noted", cls: "bg-sky-100 text-sky-800" },
  unreconciled: { label: "⚠ Pending", cls: "bg-amber-100 text-amber-800" },
};

// --- componente --------------------------------------------------------------

export function BankReconciliation({ canView }: { canView: boolean }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState<"all" | "unreconciled" | "matched" | "bank_charge">("all");
  const [q, setQ] = useState("");
  const [matchTx, setMatchTx] = useState<LogRow | null>(null);
  const [proposals, setProposals] = useState<AutomatchResp | null>(null);

  const log = useQuery({
    queryKey: ["bank-recon"],
    queryFn: () => api.get<LogResp>("/bank/reconciliation/log"),
    enabled: canView,
  });
  const recap = useQuery({
    queryKey: ["bank-fees-recap"],
    queryFn: () => api.get<Recap>("/bank/fees/recap"),
    enabled: canView,
  });
  const statements = useQuery({
    queryKey: ["bank-statements"],
    queryFn: () => api.get<Statement[]>("/bank/statements"),
    enabled: canView,
  });

  const rows = log.data?.rows ?? [];
  const counts = useMemo(() => {
    const c = { all: rows.length, unreconciled: 0, matched: 0, bank_charge: 0 };
    for (const r of rows) {
      if (r.recon_status === "unreconciled") c.unreconciled++;
      else if (r.recon_status === "matched") c.matched++;
      else if (r.recon_status === "bank_charge") c.bank_charge++;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.recon_status !== filter) return false;
      if (!needle) return true;
      return [r.description, r.ledger_payee, r.invoice_no, r.provider, r.txn_no].some((x) =>
        (x ?? "").toString().toLowerCase().includes(needle),
      );
    });
  }, [rows, filter, q]);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["bank-recon"] });
    qc.invalidateQueries({ queryKey: ["bank-fees-recap"] });
    qc.invalidateQueries({ queryKey: ["bank-statements"] });
  }

  async function upload(f: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(`/api/bank/statements/import`, { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(j.detail || j.title || "Could not read the statement.");
        return;
      }
      alert(
        `Statement ${j.period_from ?? ""} → ${j.period_to ?? ""}: ` +
          `${j.new} new movements (${j.already} already there). Closing balance ${m2(j.closing_balance)}.`,
      );
      refresh();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const runAutomatch = useMutation({
    mutationFn: () => api.post<AutomatchResp>("/bank/reconciliation/automatch", {}),
    onSuccess: (d) => setProposals(d),
  });
  const applyMatches = useMutation({
    mutationFn: (pairs: { tx_id: number; sheet_row_id: number }[]) =>
      api.post<{ applied: number }>("/bank/reconciliation/automatch/apply", { pairs }),
    onSuccess: (d) => {
      setProposals(null);
      refresh();
      alert(`${d.applied} movements reconciled.`);
    },
  });
  const reconcile = useMutation({
    mutationFn: (v: { tx_id: number; sheet_row_id: number | null; note?: string | null }) =>
      api.post(`/bank/tx/${v.tx_id}/reconcile`, {
        sheet_row_id: v.sheet_row_id,
        note: v.note ?? null,
      }),
    onSuccess: () => {
      setMatchTx(null);
      refresh();
    },
  });

  if (!canView)
    return <p className="text-sm text-amber-600">You need the «bank.view» permission.</p>;

  const fee = (b?: FeeBlock, k?: keyof FeeBlock) => (b && k ? m2(b[k]) || "$0.00" : "—");

  return (
    <div className="space-y-5">
      {/* Barra de acciones */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.csv,.xls,.xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="rounded bg-[#2d3a5c] px-3 py-2 text-sm font-medium text-white hover:bg-[#243049] disabled:opacity-50"
        >
          {uploading ? "Reading…" : "⬆ Upload LAFISE statement (PDF / CSV / xls)"}
        </button>
        <button
          onClick={() => runAutomatch.mutate()}
          disabled={runAutomatch.isPending}
          className="rounded border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          {runAutomatch.isPending ? "Matching…" : "🔎 Auto-match"}
        </button>
        <div className="ml-auto text-sm text-slate-500">
          {counts.unreconciled > 0 ? (
            <span className="font-semibold text-amber-600">{counts.unreconciled} unreconciled</span>
          ) : (
            <span className="text-emerald-600">Everything reconciled ✓</span>
          )}
        </div>
      </div>

      {/* Recap de comisiones MTD/YTD */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(["mtd", "ytd"] as const).map((k) => {
          const b = recap.data?.[k];
          return (
            <div key={k} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-slate-700">
                  {k === "mtd" ? "Bank fees — Month to date" : "Bank fees — Year to date"}
                </h3>
                <span className="text-xs text-slate-400">as of {recap.data?.asof ?? "—"}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <Row label="Transfer fees" v={fee(b, "transfer_fee")} />
                <Row label="Interest earned" v={fee(b, "interest")} good />
                <Row label="Admin charges" v={fee(b, "admin_charge")} />
                <Row label="FX charges" v={fee(b, "fx_charge")} />
                <Row label="Total charges" v={fee(b, "total_charges")} bold />
                <Row label="Net (interest − fees)" v={fee(b, "net")} bold good />
              </div>
            </div>
          );
        })}
      </div>

      {/* Propuestas de auto-match */}
      {proposals && (
        <ProposalsPanel
          data={proposals}
          onClose={() => setProposals(null)}
          onApply={(pairs) => applyMatches.mutate(pairs)}
          applying={applyMatches.isPending}
        />
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "unreconciled", "matched", "bank_charge"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === f
                ? "bg-[#2d3a5c] text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f === "all"
              ? "All"
              : f === "bank_charge"
                ? "Bank charges"
                : f === "matched"
                  ? "Reconciled"
                  : "Pending"}{" "}
            ({counts[f]})
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search description / provider / invoice…"
          className="ml-auto w-64 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </div>

      {/* Log extendido */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <Th>Date</Th>
              <Th>Description</Th>
              <Th right>Debit</Th>
              <Th right>Credit</Th>
              <Th right>Balance</Th>
              <Th>Type</Th>
              <Th>Ledger / Short Payment</Th>
              <Th>Invoice · Provider</Th>
              <Th>Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {log.isLoading && (
              <tr>
                <td colSpan={10} className="p-4 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {shown.map((r) => {
              const st = STATUS_META[r.recon_status];
              const isPayment = Number(r.debit) > 0 && r.recon_status !== "bank_charge";
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-1.5">{r.tx_date}</td>
                  <td className="px-3 py-1.5">{r.description}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-rose-600">
                    {m2(r.debit)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-emerald-700">
                    {m2(r.credit)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {m2(r.balance)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-500">
                    {r.class_label ?? r.class_code}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {r.short_payment_no != null ? (
                      <span>
                        <span className="font-semibold text-indigo-700">
                          SP #{r.short_payment_no}
                        </span>{" "}
                        <span className="text-slate-500">{r.ledger_payee}</span>
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-xs">
                    {r.invoice_no ? (
                      <span>
                        <span className="font-medium">{r.invoice_no}</span>{" "}
                        <span className="text-slate-500">{r.provider}</span>
                      </span>
                    ) : isPayment ? (
                      <span className="text-amber-600">no invoice</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {r.recon_status === "matched" ? (
                      <button
                        onClick={() => reconcile.mutate({ tx_id: r.id, sheet_row_id: null })}
                        className="text-xs text-slate-400 hover:text-rose-600"
                      >
                        unlink
                      </button>
                    ) : (
                      isPayment && (
                        <button
                          onClick={() => setMatchTx(r)}
                          className="text-xs font-medium text-indigo-600 hover:underline"
                        >
                          match…
                        </button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
            {!log.isLoading && shown.length === 0 && (
              <tr>
                <td colSpan={10} className="p-6 text-center text-slate-400">
                  No movements. Upload a LAFISE statement to start.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Histórico de estados */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Statement history</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <Th>Period</Th>
                <Th>File</Th>
                <Th>Source</Th>
                <Th right>Opening</Th>
                <Th right>Closing</Th>
                <Th right>Movements</Th>
                <Th right>New</Th>
                <Th>Uploaded</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(statements.data ?? []).map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {s.period_from} → {s.period_to}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{s.filename}</td>
                  <td className="px-3 py-1.5 text-xs uppercase text-slate-400">{s.source_kind}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{m2(s.opening_balance)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{m2(s.closing_balance)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.n_movements}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.n_new}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-400">
                    {s.uploaded_at?.slice(0, 16).replace("T", " ")} · {s.uploaded_by}
                  </td>
                </tr>
              ))}
              {(statements.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-slate-400">
                    No statements uploaded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {matchTx && (
        <MatchModal
          tx={matchTx}
          onClose={() => setMatchTx(null)}
          onPick={(sheet_row_id) => reconcile.mutate({ tx_id: matchTx.id, sheet_row_id })}
          onNote={(note) => reconcile.mutate({ tx_id: matchTx.id, sheet_row_id: null, note })}
        />
      )}
    </div>
  );
}

function Row({
  label,
  v,
  bold,
  good,
}: { label: string; v: string; bold?: boolean; good?: boolean }) {
  return (
    <>
      <span className={`text-slate-500 ${bold ? "font-semibold text-slate-700" : ""}`}>
        {label}
      </span>
      <span
        className={`text-right tabular-nums ${bold ? "font-semibold" : ""} ${
          good ? "text-emerald-700" : "text-slate-800"
        }`}
      >
        {v}
      </span>
    </>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}>{children}</th>
  );
}

// --- panel de propuestas -----------------------------------------------------

function ProposalsPanel({
  data,
  onClose,
  onApply,
  applying,
}: {
  data: AutomatchResp;
  onClose: () => void;
  onApply: (pairs: { tx_id: number; sheet_row_id: number }[]) => void;
  applying: boolean;
}) {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(data.auto.map((p) => p.tx_id)));
  const all = [...data.auto, ...data.review];
  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const pairs = all
    .filter((p) => picked.has(p.tx_id))
    .map((p) => ({ tx_id: p.tx_id, sheet_row_id: p.sheet_row_id }));

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-indigo-800">
          Suggested matches — {data.auto.length} confident, {data.review.length} to review (
          {data.pending} pending)
        </h3>
        <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-700">
          close
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto rounded border border-indigo-100 bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-1"></th>
              <th className="px-2 py-1 text-left">Bank movement</th>
              <th className="px-2 py-1 text-right">Amount</th>
              <th className="px-2 py-1 text-left">→ Ledger / SP</th>
              <th className="px-2 py-1 text-left">Tier</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {all.map((p) => (
              <tr key={p.tx_id} className={picked.has(p.tx_id) ? "bg-emerald-50/50" : ""}>
                <td className="px-2 py-1">
                  <input
                    type="checkbox"
                    checked={picked.has(p.tx_id)}
                    onChange={() => toggle(p.tx_id)}
                  />
                </td>
                <td className="px-2 py-1">
                  <span className="text-slate-400">{p.tx_date}</span> {p.tx_description}
                </td>
                <td className="px-2 py-1 text-right tabular-nums">{m2(p.tx_amount)}</td>
                <td className="px-2 py-1">
                  <span className="font-semibold text-indigo-700">SP #{p.short_payment_no}</span>{" "}
                  <span className="text-slate-500">{p.ledger_payee}</span>
                  {p.provider && <span className="text-slate-400"> · {p.provider}</span>}
                </td>
                <td className="px-2 py-1">
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      p.tier === "auto"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {p.tier} · {p.score}
                  </span>
                  {p.n_candidates > 1 && (
                    <span className="ml-1 text-slate-400">{p.n_candidates} cand.</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => onApply(pairs)}
          disabled={applying || pairs.length === 0}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Apply {pairs.length} match{pairs.length === 1 ? "" : "es"}
        </button>
        <span className="text-xs text-slate-500">
          Confident matches are pre-checked. Review the amber ones before applying.
        </span>
      </div>
    </div>
  );
}

// --- modal de match manual ---------------------------------------------------

function MatchModal({
  tx,
  onClose,
  onPick,
  onNote,
}: {
  tx: LogRow;
  onClose: () => void;
  onPick: (sheet_row_id: number) => void;
  onNote: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const cands = useQuery({
    queryKey: ["bank-recon-cands", tx.id],
    queryFn: () => api.get<Candidate[]>(`/bank/reconciliation/candidates?tx_id=${tx.id}`),
  });
  const target = Number(tx.debit) || Number(tx.credit) || 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3">
          <h3 className="text-base font-semibold">Reconcile bank movement</h3>
          <p className="text-sm text-slate-500">
            {tx.tx_date} · {tx.description} · <span className="font-medium">{m2(target)}</span>
          </p>
        </div>
        <p className="mb-2 text-xs uppercase text-slate-400">Ledger lines with the same amount</p>
        <div className="overflow-x-auto rounded border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1 text-left">Date</th>
                <th className="px-2 py-1 text-left">SP / Payee</th>
                <th className="px-2 py-1 text-left">Cost code</th>
                <th className="px-2 py-1 text-right">Paid</th>
                <th className="px-2 py-1 text-left">Invoice · Provider</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cands.isLoading && (
                <tr>
                  <td colSpan={6} className="p-3 text-center text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
              {(cands.data ?? []).map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-2 py-1">{c.entry_date?.slice(0, 10)}</td>
                  <td className="px-2 py-1">
                    {c.short_payment_no != null && (
                      <span className="font-semibold text-indigo-700">
                        SP #{c.short_payment_no}{" "}
                      </span>
                    )}
                    {c.payee}
                  </td>
                  <td className="px-2 py-1">{c.cost_code}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {m2(c.amount_paid ?? c.amount)}
                  </td>
                  <td className="px-2 py-1">
                    {c.inv_no ? (
                      <span>
                        {c.inv_no} <span className="text-slate-500">{c.provider}</span>
                      </span>
                    ) : (
                      <span className="text-amber-600">no invoice</span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      onClick={() => onPick(c.id)}
                      className="rounded bg-indigo-600 px-2 py-1 text-white hover:bg-indigo-700"
                    >
                      link
                    </button>
                  </td>
                </tr>
              ))}
              {!cands.isLoading && (cands.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="p-3 text-center text-slate-400">
                    No Ledger line with this amount. Note it below to flag it as reviewed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Or leave a note (marks it reviewed without a ledger match)"
            className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            onClick={() => note.trim() && onNote(note.trim())}
            disabled={!note.trim()}
            className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Save note
          </button>
          <button
            onClick={onClose}
            className="rounded px-3 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
