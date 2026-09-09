"use client";

import { moneyUsd, num } from "@/lib/format";
import {
  type PackageSubmission,
  type PlanningNote,
  type PlanningPackage,
  useApplyPlanningNote,
  useCreatePackage,
  useCutoff,
  useDeleteLinkSubmission,
  useDeletePackage,
  useDisbursements,
  useDeleteSubmission,
  useFinancials,
  useLinkSubmissions,
  useMe,
  useOpenShortPayment,
  usePackageSubmissions,
  usePlanningDoc,
  usePlanningPackages,
  usePlanningToShortPayment,
  useSavePlanningComments,
  useSavePlanningNote,
  useScheduleCells,
  useScheduleWeeks,
} from "@/lib/hooks";
import type { PlanningToSpResult } from "@/lib/hooks";
import type { Disbursement, WbsFinancials } from "@/lib/types";
import { useMemo, useState } from "react";

const MON = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const monthLabel = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1] ?? ym} '${ym.slice(2, 4)}`;

const cash = (n: number) =>
  Math.abs(n) < 0.005 ? <span className="text-slate-300">—</span> : moneyUsd(n);

// Celda cruda del cronograma (autenticada o pública comparten forma).
type Cell = { wbs_id: number; week_start: string; planned_amount: string | number | null };

// Envío de líneas al Short Payment. Es OPCIONAL a propósito: la vista pública
// del Planning (link sin login) NO lo recibe, así que ahí no aparece nada de esto.
export type SpTarget = {
  /** Tandas en BORRADOR: son las únicas que aceptan líneas nuevas. */
  batches: Disbursement[];
  /** La tanda abierta (la más reciente): el destino por defecto. */
  openId: number | null;
  send: (v: {
    month: string;
    lines: { wbs_id: number; amount: number | null }[];
    disbursement_id: number;
  }) => Promise<PlanningToSpResult>;
  sending: boolean;
};

const spTitle = (b: { disb_no: number; disb_sub: number; send_date?: string | null; period_month: string }) => {
  const d = new Date(`${b.send_date ?? b.period_month}T00:00:00`);
  const m = d.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
  return `#${b.disb_no}.${b.disb_sub} · ${m}`;
};

type SaveNote = (
  wbsId: number,
  patch: { note?: string | null; suggested_amount?: number | null; move_to_month?: string | null },
) => void;

// Componente PRESENTACIONAL: recibe los datos por props (sirve para la vista
// autenticada y para el link público). Toda la lógica de ventana/filtros/impresión
// vive acá; no llama hooks de datos (solo estado local de la UI).
export function PlanningDoc({
  financials,
  cells,
  weeks,
  cutoffDate,
  preparedBy,
  notes,
  comments: serverComments,
  onSaveNote,
  onSaveComments,
  shareUrl,
  loading,
  defaultMonths,
  sp,
}: {
  financials: WbsFinancials[];
  cells: Cell[];
  weeks: string[];
  cutoffDate: string;
  preparedBy: string;
  notes: PlanningNote[];
  comments: string | null;
  onSaveNote: SaveNote;
  onSaveComments: (comments: string) => void;
  shareUrl?: string | null;
  loading?: boolean;
  defaultMonths?: number;
  sp?: SpTarget;
}) {
  const printedOn = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const [months, setMonths] = useState(defaultMonths ?? 3);
  const [onlyBudget, setOnlyBudget] = useState(true);
  const [onlyPlanned, setOnlyPlanned] = useState(true);
  const [filter, setFilter] = useState("");
  const [startYm, setStartYm] = useState<string | null>(null);
  // Selección para mandar al Short Payment (solo con `sp`).
  const [sel, setSel] = useState<Set<number>>(() => new Set());
  const [spMonth, setSpMonth] = useState<string | null>(null);
  const [spBatchId, setSpBatchId] = useState<number | null>(null);
  const [spOpen, setSpOpen] = useState(false);

  const plannedByWbsMonth = useMemo(() => {
    const m = new Map<number, Map<string, number>>();
    for (const c of cells) {
      const ym = String(c.week_start).slice(0, 7);
      let row = m.get(c.wbs_id);
      if (!row) {
        row = new Map();
        m.set(c.wbs_id, row);
      }
      row.set(ym, (row.get(ym) ?? 0) + num(c.planned_amount as string | null));
    }
    return m;
  }, [cells]);

  const allMonths = useMemo(() => {
    const s = new Set<string>();
    for (const w of weeks) s.add(w.slice(0, 7));
    return [...s].sort();
  }, [weeks]);

  const defaultStart = useMemo(() => {
    const firstFutureWeek = weeks.find((w) => w >= cutoffDate);
    if (firstFutureWeek) return firstFutureWeek.slice(0, 7);
    return allMonths.find((mm) => mm >= cutoffDate.slice(0, 7)) ?? allMonths[0] ?? "";
  }, [weeks, allMonths, cutoffDate]);
  const start = startYm ?? defaultStart;
  const windowMonths = useMemo(() => {
    const i = allMonths.indexOf(start);
    return i < 0 ? [] : allMonths.slice(i, i + months);
  }, [allMonths, start, months]);

  const planOf = (id: number, ym: string) => plannedByWbsMonth.get(id)?.get(ym) ?? 0;
  const rowWindowTotal = (r: WbsFinancials) =>
    windowMonths.reduce((s, ym) => s + planOf(r.id, ym), 0);

  const q = filter.trim().toLowerCase();
  const rows = financials.filter((r) => {
    if (r.kind === "section_header" || r.kind === "proceeds") return false;
    if (onlyBudget && num(r.budget_revised) <= 0) return false;
    if (
      q &&
      !(String(r.wbs_code).toLowerCase().includes(q) || (r.title ?? "").toLowerCase().includes(q))
    )
      return false;
    if (onlyPlanned && Math.abs(rowWindowTotal(r)) < 0.005) return false;
    return true;
  });

  const groups = useMemo(() => {
    const byCat = new Map<string, WbsFinancials[]>();
    for (const r of rows) {
      const c = r.category ?? "Sin categoría";
      const arr = byCat.get(c);
      if (arr) arr.push(r);
      else byCat.set(c, [r]);
    }
    const codeKey = (c: string) => c.split(".").map((p) => Number(p) || 0);
    const cmp = (a: WbsFinancials, b: WbsFinancials) => {
      const ka = codeKey(a.wbs_code);
      const kb = codeKey(b.wbs_code);
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        if ((ka[i] ?? 0) !== (kb[i] ?? 0)) return (ka[i] ?? 0) - (kb[i] ?? 0);
      }
      return 0;
    };
    return [...byCat.entries()]
      .map(([cat, ls]) => ({ cat, ls: [...ls].sort(cmp) }))
      .sort((a, b) => cmp(a.ls[0], b.ls[0]));
  }, [rows]);

  const noteMap = useMemo(() => {
    const m = new Map<number, PlanningNote>();
    for (const n of notes) m.set(n.wbs_id, n);
    return m;
  }, [notes]);

  const [commentsBuf, setCommentsBuf] = useState<string | null>(null);
  const comments = commentsBuf ?? serverComments ?? "";

  const colTotal = (ym: string) => rows.reduce((s, r) => s + planOf(r.id, ym), 0);
  const grandWindow = rows.reduce((s, r) => s + rowWindowTotal(r), 0);
  const grandRev = rows.reduce((s, r) => s + num(r.budget_revised), 0);
  const grandSpend = rows.reduce((s, r) => s + num(r.spend), 0);
  const grandRem = rows.reduce((s, r) => s + num(r.remaining), 0);

  // --- Selección → Short Payment
  const spSelectable = !!sp;
  // Destino: el que se elija, o la tanda abierta, o la primera en borrador.
  const spBatch = sp
    ? ((spBatchId != null ? sp.batches.find((b) => b.id === spBatchId) : undefined) ??
      sp.batches.find((b) => b.id === sp.openId) ??
      sp.batches[0] ??
      null)
    : null;
  const spTargetMonth =
    spMonth && windowMonths.includes(spMonth) ? spMonth : (windowMonths[0] ?? "");
  const spAmountOf = (r: WbsFinancials) => {
    // Lo que se va a proponer: la instrucción del aprobador si existe, si no el
    // plan del mes. El usuario lo confirma (y corrige) antes de mandar.
    const sug = noteMap.get(r.id)?.suggested_amount;
    return sug != null && String(sug) !== "" ? num(sug) : planOf(r.id, spTargetMonth);
  };
  const selRows = rows.filter((r) => sel.has(r.id));
  const selTotal = selRows.reduce((t, r) => t + spAmountOf(r), 0);
  const toggleSel = (id: number) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allVisibleSelected = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggleAllVisible = () =>
    setSel(allVisibleSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const startLabel = windowMonths[0] ? monthLabel(windowMonths[0]) : "—";
  const endLabel = windowMonths.length ? monthLabel(windowMonths[windowMonths.length - 1]) : "—";
  const INP = "rounded border border-slate-300 px-2 py-0.5 text-xs";

  return (
    <div className="space-y-2">
      {/* Encabezado FORMAL — solo al imprimir */}
      <div className="mb-2 hidden border-b-2 border-slate-800 pb-2 print:block">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-lg font-bold">VENTANAS — Planning / Short Payment Preparation</div>
            <div className="text-xs text-slate-600">
              Planned expenses by project · {startLabel} → {endLabel}
            </div>
          </div>
          <div className="text-right text-xs text-slate-600">
            <div>
              Prepared by: <b>{preparedBy || "—"}</b>
            </div>
            <div>
              Date: <b>{printedOn}</b>
            </div>
          </div>
        </div>
      </div>

      {/* Link para compartir (solo vista autenticada) */}
      {shareUrl ? (
        <div
          className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs print:hidden"
          title="Anyone with this link can view and comment (no login). Send it by email/WhatsApp."
        >
          <span className="shrink-0 font-medium text-amber-800">🔗 Approval link:</span>
          <input
            readOnly
            value={shareUrl}
            className="min-w-0 flex-1 rounded border border-amber-300 bg-white px-2 py-0.5 font-mono text-[11px]"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(shareUrl)}
            className="shrink-0 rounded bg-amber-600 px-2.5 py-0.5 font-medium text-white hover:bg-amber-700"
          >
            Copy
          </button>
          <span className="hidden shrink-0 text-[11px] text-amber-700 xl:inline">
            no login · view &amp; comment
          </span>
        </div>
      ) : null}

      {/* Titular + controles en un solo bloque (menos aire entre líneas) */}
      <div className="overflow-hidden rounded-lg border border-teal-200 bg-teal-50">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 py-2">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[11px] uppercase tracking-wide text-teal-700">
              Planned to pay · {startLabel} → {endLabel}
            </span>
            <span className="text-xl font-bold text-teal-900 tabular">{moneyUsd(grandWindow)}</span>
            <span className="text-[11px] text-teal-700">
              · {rows.length} project #s — prepare the Short Payment from here
            </span>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded border border-teal-600 bg-teal-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-700 print:hidden"
          >
            🖨 Print / PDF
          </button>
        </div>

        {/* Controles */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-teal-200 bg-white/60 px-3 py-1.5 text-xs text-slate-600 print:hidden">
          <label>
            From:{" "}
            <select className={INP} value={start} onChange={(e) => setStartYm(e.target.value)}>
              {allMonths.map((mm) => (
                <option key={mm} value={mm}>
                  {monthLabel(mm)}
                </option>
              ))}
            </select>
          </label>
          <span className="flex items-center gap-1">
            Months:
            {[2, 3, 6, 12].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setMonths(n)}
                className={`rounded px-2 py-0.5 ${months === n ? "bg-slate-900 text-white" : "border border-slate-300 hover:bg-slate-50"}`}
              >
                {n}
              </button>
            ))}
          </span>
          <span className="h-4 w-px bg-slate-300" />
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={onlyBudget}
              onChange={(e) => setOnlyBudget(e.target.checked)}
            />
            Only with budget
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={onlyPlanned}
              onChange={(e) => setOnlyPlanned(e.target.checked)}
            />
            Only with a plan in the window
          </label>
          <input
            className={`${INP} ml-auto w-56`}
            placeholder="🔎 Filter by project # / title"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {/* Mandar al Short Payment — solo en la vista con login */}
        {sp ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t-2 border-teal-500 bg-teal-100 px-3 py-2 text-xs print:hidden">
            <span className="rounded bg-teal-700 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
              Send to Short Payment
            </span>
            {selRows.length === 0 ? (
              <span className="text-teal-900">
                ① Tick the lines you want (click anywhere on the row) · ② pick the month and the
                batch · ③ press the button
              </span>
            ) : null}
            <label>
              Month:{" "}
              <select
                className={INP}
                value={spTargetMonth}
                onChange={(e) => setSpMonth(e.target.value)}
              >
                {windowMonths.map((mm) => (
                  <option key={mm} value={mm}>
                    {monthLabel(mm)}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-slate-600">
              {selRows.length} selected ·{" "}
              <span className="font-semibold text-teal-800">{moneyUsd(selTotal)}</span>
            </span>
            {sel.size > 0 ? (
              <button
                type="button"
                onClick={() => setSel(new Set())}
                className="text-slate-500 underline hover:text-slate-700"
              >
                clear
              </button>
            ) : null}
            {sp.batches.length ? (
              <label>
                To:{" "}
                <select
                  className={INP}
                  value={spBatch?.id ?? ""}
                  onChange={(e) => setSpBatchId(Number(e.target.value))}
                  title="Which Short Payment batch the lines go to (drafts only)"
                >
                  {sp.batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {spTitle(b)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              disabled={selRows.length === 0 || !spBatch || sp.sending}
              onClick={() => setSpOpen(true)}
              className={
                selRows.length === 0 || !spBatch || sp.sending
                  ? "cursor-not-allowed rounded bg-slate-200 px-3 py-1 font-medium text-slate-500"
                  : "rounded bg-teal-600 px-3 py-1 font-medium text-white hover:bg-teal-700"
              }
              title={
                spBatch
                  ? "Add the selected project #s as new lines at the end of the batch"
                  : "There is no Short Payment batch in draft"
              }
            >
              ＋ Add to Short Payment
            </button>
            {spBatch ? null : (
              <span className="font-medium text-amber-700">
                ⚠ No Short Payment in draft — create the month's batch in Disbursements
              </span>
            )}
          </div>
        ) : null}
      </div>

      {spOpen && sp && spBatch ? (
        <SendToSpModal
          rows={selRows}
          month={spTargetMonth}
          monthName={monthLabel(spTargetMonth)}
          batch={spBatch}
          amountOf={spAmountOf}
          sending={sp.sending}
          onSend={(v) => sp.send({ ...v, disbursement_id: spBatch.id })}
          onDone={(ok) => {
            setSpOpen(false);
            if (ok) setSel(new Set());
          }}
        />
      ) : null}

      {/* Tabla */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="sticky top-0 bg-[#0d6b72] text-left uppercase text-white">
            <tr>
              {spSelectable ? (
                <th className="w-8 px-2 py-2 text-center print:hidden">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-teal-600"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    title="Select every project # in view"
                  />
                </th>
              ) : null}
              <th className="px-2 py-2">No. Proyecto</th>
              <th className="px-2 py-2">Task / Phase</th>
              <th className="px-2 py-2 text-right">Budget</th>
              <th className="px-2 py-2 text-right">Spent</th>
              <th className="px-2 py-2 text-right">Remaining</th>
              {windowMonths.map((ym) => (
                <th key={ym} className="px-2 py-2 text-right">
                  {monthLabel(ym)}
                </th>
              ))}
              <th className="bg-[#0a565b] px-2 py-2 text-right">
                Plan {startLabel}→{endLabel}
              </th>
              <th className="border-l-2 border-white/40 bg-[#8a5a00] px-2 py-2 text-left">Note</th>
              <th className="bg-[#8a5a00] px-2 py-2 text-right">Suggested $</th>
              <th className="bg-[#8a5a00] px-2 py-2 text-center">Move (from → to)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {groups.map((g) => (
              <GroupRows
                key={g.cat}
                cat={g.cat}
                ls={g.ls}
                windowMonths={windowMonths}
                allMonths={allMonths}
                planOf={planOf}
                rowWindowTotal={rowWindowTotal}
                noteMap={noteMap}
                saveNote={onSaveNote}
                selectable={spSelectable}
                sel={sel}
                onToggle={toggleSel}
              />
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={9 + (spSelectable ? 1 : 0) + windowMonths.length}
                  className="px-3 py-8 text-center text-slate-400"
                >
                  {loading ? "Loading…" : "No project #s match — adjust the filters."}
                </td>
              </tr>
            ) : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot>
              <tr className="border-t-4 border-double border-slate-500 bg-slate-800 text-sm font-bold text-white">
                <td className="px-2 py-2.5" colSpan={2}>
                  GRAND TOTAL ({rows.length} project #s)
                </td>
                <td className="tabular px-2 py-2.5 text-right">{moneyUsd(grandRev)}</td>
                <td className="tabular px-2 py-2.5 text-right">{moneyUsd(grandSpend)}</td>
                <td className="tabular px-2 py-2.5 text-right">{moneyUsd(grandRem)}</td>
                {windowMonths.map((ym) => (
                  <td key={ym} className="tabular px-2 py-2.5 text-right">
                    {moneyUsd(colTotal(ym))}
                  </td>
                ))}
                <td className="tabular bg-[#0a565b] px-2 py-2.5 text-right">
                  {moneyUsd(grandWindow)}
                </td>
                <td colSpan={3} className="bg-slate-800" />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {/* Comentarios generales (persisten) — editable en pantalla */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 print:hidden">
        <div className="mb-1 text-sm font-medium text-slate-700">General comments (saved)</div>
        <textarea
          className="w-full rounded border border-slate-300 p-2 text-sm"
          rows={3}
          placeholder="Comments for the approver / reviewer… (saved and shown in the printed document)"
          value={comments}
          onChange={(e) => setCommentsBuf(e.target.value)}
          onBlur={() => onSaveComments(comments)}
        />
      </div>

      {/* Bloque formal — solo al imprimir */}
      <div className="mt-6 hidden print:block">
        <div className="mb-2 text-xs text-slate-600">
          <b>
            Total to approve ({startLabel} → {endLabel}):
          </b>{" "}
          <span className="tabular text-sm font-bold text-slate-900">{moneyUsd(grandWindow)}</span>
        </div>
        <div className="mb-4 text-xs text-slate-700">
          <div className="font-medium">Comments:</div>
          <div className="mt-1 min-h-[3rem] whitespace-pre-wrap border border-slate-300 p-2">
            {comments}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-8 pt-8 text-xs text-slate-700">
          {["Prepared by", "Reviewed by", "Approved by"].map((role) => (
            <div key={role}>
              <div className="border-t border-slate-800 pt-1">{role}</div>
              <div className="mt-4 border-t border-slate-400 pt-1 text-slate-500">Date</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Confirmación antes de mandar: el owner ve exactamente qué línea y con qué
// monto va a entrar a la tanda, y puede corregir cada uno. Nada entra a ciegas.
function SendToSpModal({
  rows,
  month,
  monthName,
  batch,
  amountOf,
  sending,
  onSend,
  onDone,
}: {
  rows: WbsFinancials[];
  month: string;
  monthName: string;
  batch: Disbursement;
  amountOf: (r: WbsFinancials) => number;
  sending: boolean;
  onSend: (v: {
    month: string;
    lines: { wbs_id: number; amount: number | null }[];
  }) => Promise<PlanningToSpResult>;
  onDone: (ok: boolean) => void;
}) {
  const [amounts, setAmounts] = useState<Record<number, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, String(amountOf(r).toFixed(2))])),
  );
  const [res, setRes] = useState<PlanningToSpResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const value = (r: WbsFinancials) => Number(amounts[r.id] ?? 0) || 0;
  const total = rows.reduce((t, r) => t + value(r), 0);
  const zeros = rows.filter((r) => Math.abs(value(r)) < 0.005).length;

  const send = async () => {
    setErr(null);
    try {
      setRes(
        await onSend({
          month,
          lines: rows.map((r) => ({ wbs_id: r.id, amount: value(r) })),
        }),
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo agregar a la tanda.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 print:hidden">
      <div className="mt-10 w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 px-4 py-3">
          <div className="text-sm font-semibold text-slate-800">
            Add {rows.length} project #{rows.length === 1 ? "" : "s"} to {spTitle(batch)}
          </div>
          <div className="text-xs text-slate-500">
            {monthName} plan · they go in as new lines at the end of the batch. Amounts are
            editable — check them before sending.
          </div>
        </div>

        {res ? (
          <div className="space-y-2 px-4 py-3 text-xs">
            <div className="font-medium text-teal-800">
              ✓ {res.added.length} line{res.added.length === 1 ? "" : "s"} added ·{" "}
              {moneyUsd(num(res.total_added))}
            </div>
            {res.added.length ? (
              <div className="text-slate-600">
                {res.added.map((a) => (
                  <div key={a.line_id}>
                    line {a.line_no} · {a.wbs_code} · {moneyUsd(num(a.amount))}
                  </div>
                ))}
              </div>
            ) : null}
            {res.skipped.length ? (
              <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-800">
                <b>Skipped ({res.skipped.length}):</b>
                {res.skipped.map((k) => (
                  <div key={`${k.wbs_id}`}>
                    {k.wbs_code ?? k.wbs_id} — {k.reason}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto px-4 py-2">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1 pr-2 font-medium text-blue-700">{r.wbs_code}</td>
                    <td className="py-1 pr-2 text-slate-700">{r.title}</td>
                    <td className="py-1 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={amounts[r.id] ?? ""}
                        onChange={(e) =>
                          setAmounts((a) => ({ ...a, [r.id]: e.target.value }))
                        }
                        className="w-28 rounded border border-slate-300 px-1 py-0.5 text-right"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold">
                  <td className="py-1.5" colSpan={2}>
                    TOTAL
                  </td>
                  <td className="py-1.5 text-right text-teal-800">{moneyUsd(total)}</td>
                </tr>
              </tfoot>
            </table>
            {zeros ? (
              <div className="mt-1 text-[11px] text-amber-700">
                ⚠ {zeros} in zero — those are reported as skipped, they do not enter the batch.
              </div>
            ) : null}
          </div>
        )}

        {err ? <div className="px-4 pb-2 text-xs text-red-600">{err}</div> : null}

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-2.5">
          <button
            type="button"
            onClick={() => onDone(!!res)}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            {res ? "Close" : "Cancel"}
          </button>
          {res ? null : (
            <button
              type="button"
              disabled={sending}
              onClick={send}
              className="rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
            >
              {sending ? "Adding…" : `Add ${rows.length} to the batch`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GroupRows({
  cat,
  ls,
  windowMonths,
  allMonths,
  planOf,
  rowWindowTotal,
  noteMap,
  saveNote,
  selectable,
  sel,
  onToggle,
}: {
  cat: string;
  ls: WbsFinancials[];
  windowMonths: string[];
  allMonths: string[];
  planOf: (id: number, ym: string) => number;
  rowWindowTotal: (r: WbsFinancials) => number;
  noteMap: Map<number, PlanningNote>;
  saveNote: SaveNote;
  selectable?: boolean;
  sel?: Set<number>;
  onToggle?: (id: number) => void;
}) {
  const sub = (fn: (r: WbsFinancials) => number) => ls.reduce((s, r) => s + fn(r), 0);
  return (
    <>
      <tr className="border-t-4 border-slate-700 bg-slate-200">
        <td
          colSpan={9 + (selectable ? 1 : 0) + windowMonths.length}
          className="px-2 py-1.5 text-[12px] font-bold uppercase text-slate-800"
        >
          {cat}
        </td>
      </tr>
      {ls.map((r) => {
        const n = noteMap.get(r.id);
        return (
          <tr
            key={r.id}
            // Marcar clickeando CUALQUIER punto de la fila: la casilla sola era
            // demasiado discreta y no se encontraba.
            onClick={
              selectable
                ? (e) => {
                    const t = e.target as HTMLElement;
                    if (t.closest("input, select, button, textarea, a")) return;
                    onToggle?.(r.id);
                  }
                : undefined
            }
            className={`${selectable ? "cursor-pointer " : ""}${
              sel?.has(r.id) ? "bg-teal-100 ring-1 ring-inset ring-teal-400" : "hover:bg-teal-50/40"
            }`}
          >
            {selectable ? (
              <td className="px-2 py-1 text-center print:hidden">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-teal-600"
                  checked={sel?.has(r.id) ?? false}
                  onChange={() => onToggle?.(r.id)}
                />
              </td>
            ) : null}
            <td className="px-2 py-1 font-medium text-blue-700">{r.wbs_code}</td>
            <td className="px-2 py-1 text-slate-700">
              {r.title}
              {r.phase ? <span className="text-slate-400"> · {r.phase}</span> : null}
            </td>
            <td className="tabular px-2 py-1 text-right text-slate-600">
              {cash(num(r.budget_revised))}
            </td>
            <td className="tabular px-2 py-1 text-right text-slate-600">{cash(num(r.spend))}</td>
            <td className="tabular px-2 py-1 text-right text-slate-600">
              {cash(num(r.remaining))}
            </td>
            {windowMonths.map((ym) => (
              <td key={ym} className="tabular px-2 py-1 text-right">
                {cash(planOf(r.id, ym))}
              </td>
            ))}
            <td className="tabular bg-teal-50 px-2 py-1 text-right font-semibold text-teal-800">
              {cash(rowWindowTotal(r))}
            </td>
            <td className="border-l-2 border-slate-200 px-1 py-0.5">
              <input
                key={`n-${r.id}-${n?.note ?? ""}`}
                defaultValue={n?.note ?? ""}
                placeholder="…"
                className="w-44 rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                onBlur={(e) => saveNote(r.id, { note: e.target.value })}
              />
            </td>
            <td className="px-1 py-0.5 text-right">
              <input
                key={`a-${r.id}-${n?.suggested_amount ?? ""}`}
                type="number"
                defaultValue={n?.suggested_amount ?? ""}
                placeholder="—"
                className="w-24 rounded border border-slate-200 px-1 py-0.5 text-right text-[11px]"
                onBlur={(e) =>
                  saveNote(r.id, {
                    suggested_amount: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </td>
            <td className="px-1 py-0.5 text-center">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <span
                  className="text-[11px] font-medium text-slate-500"
                  title="Month(s) this project is currently planned in (within the window)"
                >
                  {(() => {
                    const from = windowMonths
                      .filter((ym) => planOf(r.id, ym) > 0.005)
                      .map(monthLabel);
                    return from.length ? from.join(", ") : "—";
                  })()}
                </span>
                <span className="text-slate-400">→</span>
                <select
                  className="rounded border border-slate-200 px-1 py-0.5 text-[11px]"
                  value={n?.move_to_month ?? ""}
                  onChange={(e) => saveNote(r.id, { move_to_month: e.target.value })}
                >
                  <option value="">— keep —</option>
                  {allMonths.map((mm) => (
                    <option key={mm} value={mm}>
                      {monthLabel(mm)}
                    </option>
                  ))}
                </select>
              </span>
            </td>
          </tr>
        );
      })}
      <tr className="border-y-2 border-slate-700 bg-slate-100 text-[12px] font-bold text-slate-800">
        <td colSpan={2} className="border-l-2 border-slate-700 px-2 py-1.5 text-right">
          Subtotal {cat}
        </td>
        <td className="tabular px-2 py-1 text-right">
          {moneyUsd(sub((r) => num(r.budget_revised)))}
        </td>
        <td className="tabular px-2 py-1 text-right">{moneyUsd(sub((r) => num(r.spend)))}</td>
        <td className="tabular px-2 py-1 text-right">{moneyUsd(sub((r) => num(r.remaining)))}</td>
        {windowMonths.map((ym) => (
          <td key={ym} className="tabular px-2 py-1 text-right">
            {moneyUsd(sub((r) => planOf(r.id, ym)))}
          </td>
        ))}
        <td className="tabular border-r-2 border-slate-700 bg-teal-100 px-2 py-1 text-right text-teal-900">
          {moneyUsd(sub(rowWindowTotal))}
        </td>
        <td colSpan={3} className="bg-slate-100" />
      </tr>
    </>
  );
}

// ---- Paquetes de aprobación (autenticado): crear/listar/compartir ----------
function PackagesPanel() {
  const pkgs = usePlanningPackages();
  const create = useCreatePackage();
  const del = useDeletePackage();
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [months, setMonths] = useState(3);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = (t: string) => `${origin}/share/package/${t}`;
  const F = "rounded border border-slate-300 px-2 py-1 text-sm";

  // Arranca plegado: la pantalla abre directo en la tabla.
  return (
    <details className="rounded-lg border border-slate-200 bg-white print:hidden">
      <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium">
        📦 Approval packages — a frozen link per month/send ({pkgs.data?.length ?? 0})
      </summary>
      <div className="space-y-3 border-t border-slate-200 p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            Name
            <input
              className={`${F} ml-1`}
              placeholder="e.g. September 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="text-xs text-slate-600">
            From month
            <input
              type="month"
              className={`${F} ml-1`}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-xs text-slate-600">
            Months
            <select
              className={`${F} ml-1`}
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
            >
              {[1, 2, 3, 6, 12].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!name.trim() || !from || create.isPending}
            onClick={() =>
              create.mutate(
                { name: name.trim(), period_from: from, months },
                { onSuccess: () => setName("") },
              )
            }
            className="rounded bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {create.isPending ? "Creating…" : "＋ Create package"}
          </button>
          <span className="text-[11px] text-slate-400">
            Freezes this month's planned amounts into its own link + notes.
          </span>
        </div>
        {pkgs.data && pkgs.data.length > 0 ? (
          <table className="w-full text-xs">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1">Package</th>
                <th>Period</th>
                <th>Read receipt</th>
                <th>Returned</th>
                <th>Approval link (no password)</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pkgs.data.map((p) => (
                <PackageRow
                  key={p.id}
                  p={p}
                  url={url(p.token)}
                  onDelete={() => {
                    if (window.confirm(`Delete package "${p.name}"?`)) del.mutate(p.id);
                  }}
                />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-slate-400">
            No packages yet. Create one to send a fixed monthly snapshot for approval.
          </p>
        )}
      </div>
    </details>
  );
}

// Una fila de paquete: read-receipt + link + versiones devueltas (expandible).
function PackageRow({
  p,
  url,
  onDelete,
}: {
  p: PlanningPackage;
  url: string;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <td className="py-1 font-medium">{p.name}</td>
        <td className="text-slate-500">
          {p.period_from} · {p.months}m
        </td>
        <td>
          {p.opened_count > 0 ? (
            <span className="text-emerald-700" title={`Last opened ${p.last_opened_at ?? ""}`}>
              ✓ Opened{p.opened_count > 1 ? ` ×${p.opened_count}` : ""}
              {p.opened_at ? ` · ${p.opened_at.slice(0, 10)}` : ""}
            </span>
          ) : (
            <span className="text-slate-400">Not opened yet</span>
          )}
        </td>
        <td>
          {p.submission_count > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="rounded border border-amber-500 px-2 py-0.5 font-medium text-amber-700 hover:bg-amber-50"
            >
              {open ? "▾" : "▸"} {p.submission_count} version
              {p.submission_count > 1 ? "s" : ""}
            </button>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(url)}
            className="rounded border border-teal-500 px-2 py-0.5 text-teal-700 hover:bg-teal-50"
          >
            Copy link
          </button>
          <a href={url} target="_blank" rel="noreferrer" className="ml-2 text-blue-600 underline">
            Open
          </a>
        </td>
        <td className="text-right">
          <button type="button" onClick={onDelete} className="text-red-500 hover:underline">
            Delete
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-amber-50/40 px-3 py-2">
            <SubmissionsPanel pid={p.id} />
          </td>
        </tr>
      )}
    </>
  );
}

// Tarjetas de las versiones devueltas por el aprobador (comentarios + notas).
function SubmissionCards({
  list,
  onDelete,
}: {
  list: PackageSubmission[];
  onDelete: (sid: number) => void;
}) {
  const apply = useApplyPlanningNote();
  const applyNote = (n: {
    wbs_id: number;
    suggested_amount: string | null;
    move_to_month: string | null;
  }) => {
    const amt = n.suggested_amount != null ? Number(n.suggested_amount) : null;
    const parts: string[] = [];
    if (n.move_to_month)
      parts.push(`move project #${n.wbs_id}'s upcoming plan to ${n.move_to_month}`);
    if (amt != null) parts.push(`set the amount to ${moneyUsd(amt)}`);
    if (
      !window.confirm(
        `Apply to the Job Cost schedule:\n\n${parts.join(" and ")}.\n\nThis edits the real schedule (future months only). Continue?`,
      )
    )
      return;
    apply.mutate(
      { wbs_id: n.wbs_id, suggested_amount: amt, move_to_month: n.move_to_month },
      {
        onSuccess: (r) => window.alert(`Applied ✓\n\n${r.description}`),
        onError: () =>
          window.alert("Could not apply — check the target month isn't locked history."),
      },
    );
  };
  if (list.length === 0) return <p className="text-xs text-slate-400">No returned versions.</p>;
  return (
    <div className="space-y-2">
      {list.map((s: PackageSubmission) => {
        const withNotes = (s.notes ?? []).filter(
          (n) => n.note || n.suggested_amount != null || n.move_to_month,
        );
        return (
          <div key={s.id} className="rounded border border-amber-300 bg-white p-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-slate-700">
                {s.reviewer_name || "Reviewer"} ·{" "}
                <span className="font-normal text-slate-500">
                  {s.submitted_at?.slice(0, 16).replace("T", " ")}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Delete this returned version?")) onDelete(s.id);
                }}
                className="text-xs text-red-500 hover:underline"
              >
                Delete
              </button>
            </div>
            {s.comments && (
              <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">{s.comments}</p>
            )}
            {withNotes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
                {withNotes.map((n) => (
                  <li key={n.wbs_id} className="flex items-center gap-1">
                    <span>
                      • <span className="font-medium">#{n.wbs_id}</span>
                      {n.note ? ` — ${n.note}` : ""}
                      {n.suggested_amount != null
                        ? ` · suggests ${moneyUsd(num(n.suggested_amount))}`
                        : ""}
                      {n.move_to_month ? ` · move to ${n.move_to_month}` : ""}
                    </span>
                    {n.suggested_amount != null || n.move_to_month ? (
                      <button
                        type="button"
                        disabled={apply.isPending}
                        onClick={() => applyNote(n)}
                        className="rounded border border-teal-500 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                        title="Apply this change to the Job Cost schedule"
                      >
                        Apply
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {!s.comments && withNotes.length === 0 && (
              <p className="mt-1 text-[11px] text-slate-400">(No comments or notes)</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Versiones devueltas de un PAQUETE.
function SubmissionsPanel({ pid }: { pid: number }) {
  const subs = usePackageSubmissions(pid);
  const del = useDeleteSubmission();
  if (subs.isLoading) return <p className="text-xs text-slate-400">Loading…</p>;
  return <SubmissionCards list={subs.data ?? []} onDelete={(sid) => del.mutate({ pid, sid })} />;
}

// Estado del LINK NORMAL de Planning: read-receipt + versiones devueltas.
function LinkStatusPanel({
  openedCount,
  openedAt,
  lastOpenedAt,
  submissionCount,
}: {
  openedCount: number;
  openedAt: string | null;
  lastOpenedAt: string | null;
  submissionCount: number;
}) {
  const [open, setOpen] = useState(false);
  const subs = useLinkSubmissions(open);
  const del = useDeleteLinkSubmission();
  return (
    <details className="rounded-lg border border-slate-200 bg-white print:hidden">
      <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium">
        🔗 General link — read receipt &amp; returned versions
      </summary>
      <div className="space-y-2 border-t border-slate-200 p-3 text-xs">
        <div>
          <span className="text-slate-500">Read receipt: </span>
          {openedCount > 0 ? (
            <span className="text-emerald-700" title={`Last opened ${lastOpenedAt ?? ""}`}>
              ✓ Opened{openedCount > 1 ? ` ×${openedCount}` : ""}
              {openedAt ? ` · first ${openedAt.slice(0, 10)}` : ""}
            </span>
          ) : (
            <span className="text-slate-400">Not opened yet</span>
          )}
        </div>
        <div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            disabled={submissionCount === 0}
            className="rounded border border-amber-500 px-2 py-0.5 font-medium text-amber-700 hover:bg-amber-50 disabled:border-slate-200 disabled:text-slate-400"
          >
            {open ? "▾" : "▸"} {submissionCount} returned version{submissionCount === 1 ? "" : "s"}
          </button>
        </div>
        {open && (
          <div className="pt-1">
            {subs.isLoading ? (
              <p className="text-slate-400">Loading…</p>
            ) : (
              <SubmissionCards list={subs.data ?? []} onDelete={(sid) => del.mutate(sid)} />
            )}
          </div>
        )}
      </div>
    </details>
  );
}

// ---- Vista AUTENTICADA (tab Planning) --------------------------------------
export function PlanningView() {
  const fin = useFinancials();
  const cells = useScheduleCells();
  const weeks = useScheduleWeeks();
  const cutoff = useCutoff();
  const me = useMe();
  const doc = usePlanningDoc();
  const saveNoteMut = useSavePlanningNote();
  const saveCommentsMut = useSavePlanningComments();
  const openSp = useOpenShortPayment();
  const disbs = useDisbursements();
  const toSpMut = usePlanningToShortPayment();
  // Solo las tandas en borrador aceptan líneas nuevas; la más reciente primero.
  const draftBatches = useMemo(
    () =>
      (disbs.data ?? [])
        .filter((d) => d.status === "draft")
        .sort(
          (a, b) =>
            b.period_month.localeCompare(a.period_month) ||
            b.disb_no - a.disb_no ||
            b.disb_sub - a.disb_sub,
        ),
    [disbs.data],
  );

  const notes = doc.data?.notes ?? [];
  const noteByWbs = useMemo(() => {
    const m = new Map<number, PlanningNote>();
    for (const n of notes) m.set(n.wbs_id, n);
    return m;
  }, [notes]);

  const saveNote: SaveNote = (wbsId, patch) => {
    const cur = noteByWbs.get(wbsId);
    saveNoteMut.mutate({
      wbs_id: wbsId,
      note: patch.note !== undefined ? patch.note || null : (cur?.note ?? null),
      suggested_amount:
        patch.suggested_amount !== undefined
          ? patch.suggested_amount
          : cur?.suggested_amount != null
            ? Number(cur.suggested_amount)
            : null,
      move_to_month:
        patch.move_to_month !== undefined
          ? patch.move_to_month || null
          : (cur?.move_to_month ?? null),
    });
  };

  const token = doc.data?.share_token;
  const shareUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/share/planning/${token}`
      : null;

  return (
    <div className="space-y-2">
      {/* Los dos paneles plegables van lado a lado: ocupan una franja, no dos. */}
      <div className="grid gap-2 lg:grid-cols-2">
        <PackagesPanel />
        <LinkStatusPanel
          openedCount={doc.data?.opened_count ?? 0}
          openedAt={doc.data?.opened_at ?? null}
          lastOpenedAt={doc.data?.last_opened_at ?? null}
          submissionCount={doc.data?.submission_count ?? 0}
        />
      </div>
      <PlanningDoc
        financials={fin.data ?? []}
        cells={cells.data ?? []}
        weeks={weeks.data?.weeks ?? []}
        cutoffDate={cutoff.data?.cutoff_date ?? ""}
        preparedBy={me.data?.full_name ?? ""}
        notes={notes}
        comments={doc.data?.comments ?? null}
        onSaveNote={saveNote}
        onSaveComments={(c) => saveCommentsMut.mutate(c)}
        shareUrl={shareUrl}
        loading={fin.isLoading}
        sp={{
          batches: draftBatches,
          openId: openSp.data?.id ?? null,
          sending: toSpMut.isPending,
          send: (v) => toSpMut.mutateAsync(v),
        }}
      />
    </div>
  );
}
