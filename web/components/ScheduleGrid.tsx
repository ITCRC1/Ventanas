"use client";

import { money, num } from "@/lib/format";
import {
  useClearCell,
  useFinancials,
  useMe,
  useScheduleCells,
  useScheduleWeeks,
  useTaskStates,
  useUpsertCell,
} from "@/lib/hooks";
import {
  type CellIndex,
  type View,
  buildColumns,
  columnTotal,
  indexCells,
  topGroups,
} from "@/lib/schedule";
import type { TaskState, WbsFinancials } from "@/lib/types";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type ReactNode, useMemo, useRef, useState } from "react";

// Anchos de las columnas fijas de la izquierda (identidad + presupuesto).
const W_ID = 210; // WBS + descripción
const W_TXT = 78; // categoría / fase
const W_MONEY = 74; // columnas de dinero
const LEFT_W = W_ID + W_TXT * 2 + W_MONEY * 5; // = 748
const YEAR_W = 96; // columna FULL Year (congelada a la derecha)
const ROW_H = 30;
const CAT_H = 26;
const HDR_H = 44;
const WEEK_W = 76;
const AGG_W = 104;

function compact(n: number): string {
  if (n === 0) return "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1000).toFixed(2)}K`;
  return String(Math.round(n));
}

// Celda de dinero de la columna fija: negativos en rojo.
function moneyNode(v: string | number): ReactNode {
  const n = num(v);
  return <span className={n < 0 ? "text-red-600" : undefined}>{money(n)}</span>;
}

interface SelectedCell {
  wbsId: number;
  week: string;
}

// Subtotales de una categoría (columnas de dinero fijas).
interface Sums {
  rev: number;
  spend: number;
  rem: number;
  fc: number;
  funding: number;
}
const zeroSums = (): Sums => ({ rev: 0, spend: 0, rem: 0, fc: 0, funding: 0 });
function addSums(s: Sums, r: WbsFinancials): void {
  s.rev += num(r.budget_revised);
  s.spend += num(r.spend);
  s.rem += num(r.remaining);
  s.fc += num(r.forecast);
  s.funding += num(r.forecast) - num(r.spend); // Funding Pending = Forecast − YTD Expense
}

// Filas que se pintan (mismas en los tres paneles → alineadas verticalmente).
type DRow =
  | { kind: "cat"; category: string }
  | { kind: "line"; r: WbsFinancials }
  | { kind: "total"; category: string; lines: WbsFinancials[]; sums: Sums }
  | { kind: "grand"; lines: WbsFinancials[]; sums: Sums };

function rowHeight(kind: DRow["kind"]): number {
  return kind === "cat" ? CAT_H : ROW_H;
}

function CellEditor({
  selected,
  states,
  index,
  onDone,
}: {
  selected: SelectedCell;
  states: TaskState[];
  index: CellIndex;
  onDone: () => void;
}) {
  const upsert = useUpsertCell();
  const clear = useClearCell();
  const existing = index.get(selected.wbsId)?.get(selected.week);
  const [amount, setAmount] = useState(existing?.amount != null ? String(existing.amount) : "");
  const [stateId, setStateId] = useState(existing?.state_id ?? 2);

  async function save() {
    await upsert.mutateAsync({
      wbs_id: selected.wbsId,
      week_start: selected.week,
      planned_amount: amount === "" ? null : Number(amount),
      state_id: stateId,
    });
    onDone();
  }

  async function remove() {
    await clear.mutateAsync({ wbs_id: selected.wbsId, week_start: selected.week });
    onDone();
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <span className="font-medium">Week {selected.week}</span>
      <input
        type="number"
        className="w-32 rounded border border-slate-300 px-2 py-1"
        placeholder="Amount"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <select
        className="rounded border border-slate-300 px-2 py-1"
        value={stateId}
        onChange={(e) => setStateId(Number(e.target.value))}
      >
        {states.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={save}
        disabled={upsert.isPending}
        className="rounded bg-slate-900 px-3 py-1 text-white hover:bg-slate-700 disabled:opacity-50"
      >
        Save
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={clear.isPending || !existing}
        className="rounded border border-slate-300 px-3 py-1 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
      >
        Clear
      </button>
      <button
        type="button"
        onClick={onDone}
        className="ml-auto text-slate-400 hover:text-slate-600"
      >
        Close
      </button>
      {upsert.error ? <span className="w-full text-red-600">{String(upsert.error)}</span> : null}
    </div>
  );
}

// Encabezado de una columna de dinero fija.
function MoneyHead({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex items-end justify-end border-r border-slate-200 px-1 pb-1 text-right text-[9px] font-semibold uppercase leading-tight text-slate-500"
      style={{ width: W_MONEY }}
    >
      {children}
    </div>
  );
}

// Celda de dinero fija (línea o subtotal).
function MoneyCell({ v, bold }: { v: number; bold?: boolean }) {
  return (
    <div
      className={`tabular flex items-center justify-end border-r border-slate-100 px-1 text-right text-[11px] ${
        bold ? "font-semibold" : ""
      }`}
      style={{ width: W_MONEY }}
    >
      {moneyNode(v)}
    </div>
  );
}

export function ScheduleGrid() {
  const me = useMe();
  const weeks = useScheduleWeeks();
  const cells = useScheduleCells();
  const financials = useFinancials();
  const states = useTaskStates();

  const [view, setView] = useState<View>("month");
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const rightPane = useRef<HTMLDivElement>(null);

  const canEdit = me.data?.permissions.includes("schedule.edit") ?? false;
  const weekList = weeks.data?.weeks ?? [];
  const columns = useMemo(() => buildColumns(weekList, view), [weekList, view]);
  const tops = useMemo(() => topGroups(columns, view), [columns, view]);
  const index = useMemo(() => indexCells(cells.data ?? []), [cells.data]);
  const stateColor = useMemo(
    () => new Map((states.data ?? []).map((s) => [s.id, s.color_hex])),
    [states.data],
  );

  // Agrupa las líneas por categoría (mismo criterio que Timeline / Job Cost):
  // encabezado de sección + líneas + subtotal TOTAL Category, y un gran total.
  const { displayRows, lineCount } = useMemo(() => {
    const lines = (financials.data ?? []).filter((r) => r.kind !== "section_header");
    const byCat = new Map<string, WbsFinancials[]>();
    for (const r of lines) {
      const c = r.category ?? "Uncategorized";
      const arr = byCat.get(c);
      if (arr) arr.push(r);
      else byCat.set(c, [r]);
    }
    const out: DRow[] = [];
    const grandLines: WbsFinancials[] = [];
    const grandSums = zeroSums();
    for (const [category, ls] of byCat) {
      out.push({ kind: "cat", category });
      const sums = zeroSums();
      for (const r of ls) {
        out.push({ kind: "line", r });
        addSums(sums, r);
        addSums(grandSums, r);
        grandLines.push(r);
      }
      out.push({ kind: "total", category, lines: ls, sums });
    }
    if (grandLines.length) out.push({ kind: "grand", lines: grandLines, sums: grandSums });
    return { displayRows: out, lineCount: lines.length };
  }, [financials.data]);

  const colW = view === "week" ? WEEK_W : AGG_W;
  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: columns.length,
    getScrollElement: () => rightPane.current,
    estimateSize: () => colW,
    overscan: 6,
  });

  if (weeks.isLoading || cells.isLoading || financials.isLoading) {
    return <p className="text-sm text-slate-500">Loading schedule…</p>;
  }

  const virtualCols = colVirtualizer.getVirtualItems();
  const totalW = colVirtualizer.getTotalSize();

  // Suma planificada de una columna para un conjunto de líneas.
  const colSum = (lines: WbsFinancials[], wks: string[]) =>
    lines.reduce((s, l) => s + columnTotal(index, l.id, wks), 0);

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-sm text-slate-500">View by:</span>
        {(["week", "month", "quarter"] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setView(v);
              setSelected(null);
            }}
            className={`rounded px-3 py-1 text-sm ${
              view === v
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {v === "week" ? "Week" : v === "month" ? "Month" : "Quarter"}
          </button>
        ))}
        <span className="ml-2 text-xs text-slate-400">
          {lineCount} lines · {weekList.length} weeks
          {view === "week" && canEdit ? " · click a cell to edit" : ""}
        </span>
      </div>

      {selected && states.data ? (
        <CellEditor
          key={`${selected.wbsId}-${selected.week}`}
          selected={selected}
          states={states.data}
          index={index}
          onDone={() => setSelected(null)}
        />
      ) : null}

      <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
        {/* Columna fija de identidad + presupuesto */}
        <div className="shrink-0" style={{ width: LEFT_W }}>
          <div
            className="sticky top-0 z-20 flex border-b border-r border-slate-200 bg-slate-100"
            style={{ height: HDR_H }}
          >
            <div
              className="flex items-end px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500"
              style={{ width: W_ID }}
            >
              WBS · Description
            </div>
            <div
              className="flex items-end px-1 pb-1 text-[9px] font-semibold uppercase text-slate-500"
              style={{ width: W_TXT }}
            >
              Category
            </div>
            <div
              className="flex items-end px-1 pb-1 text-[9px] font-semibold uppercase text-slate-500"
              style={{ width: W_TXT }}
            >
              Phase
            </div>
            <MoneyHead>Budget Revised</MoneyHead>
            <MoneyHead>YTD Expense</MoneyHead>
            <MoneyHead>Remaining</MoneyHead>
            <MoneyHead>Forecast</MoneyHead>
            <MoneyHead>Funding Pending</MoneyHead>
          </div>

          {displayRows.map((row) => {
            const h = rowHeight(row.kind);
            if (row.kind === "cat") {
              return (
                <div
                  key={`L-cat-${row.category}`}
                  className="flex items-center border-b border-t-2 border-slate-300 border-t-slate-400 bg-[#EAF0FA] px-3 text-[12px] font-bold uppercase text-slate-800"
                  style={{ height: h }}
                >
                  <span className="truncate">{row.category}</span>
                </div>
              );
            }
            if (row.kind === "total") {
              return (
                <div
                  key={`L-tot-${row.category}`}
                  className="flex border-y-2 border-slate-500 bg-[#DCE6F4] text-[12px] font-bold"
                  style={{ height: h }}
                >
                  <div
                    className="flex items-center justify-end px-2 text-right"
                    style={{ width: W_ID + W_TXT * 2 }}
                  >
                    TOTAL {row.category}
                  </div>
                  <MoneyCell v={row.sums.rev} bold />
                  <MoneyCell v={row.sums.spend} bold />
                  <MoneyCell v={row.sums.rem} bold />
                  <MoneyCell v={row.sums.fc} bold />
                  <MoneyCell v={row.sums.funding} bold />
                </div>
              );
            }
            if (row.kind === "grand") {
              return (
                <div
                  key="L-grand"
                  className="flex border-t-2 border-slate-800 bg-[#C8DCF0] text-[12px] font-bold"
                  style={{ height: h }}
                >
                  <div className="flex items-center px-3" style={{ width: W_ID + W_TXT * 2 }}>
                    PROJECT TOTAL
                  </div>
                  <MoneyCell v={row.sums.rev} bold />
                  <MoneyCell v={row.sums.spend} bold />
                  <MoneyCell v={row.sums.rem} bold />
                  <MoneyCell v={row.sums.fc} bold />
                  <MoneyCell v={row.sums.funding} bold />
                </div>
              );
            }
            const r = row.r;
            return (
              <div
                key={r.id}
                className="flex border-b border-slate-100 hover:bg-slate-50"
                style={{ height: h }}
              >
                <div
                  className="flex items-center gap-2 px-3"
                  style={{ width: W_ID }}
                  title={r.title}
                >
                  <span className="font-mono text-[10px] text-slate-400">{r.wbs_code}</span>
                  <span className="truncate text-sm">{r.title}</span>
                </div>
                <div
                  className="flex items-center px-1 text-[10px] text-slate-500"
                  style={{ width: W_TXT }}
                >
                  <span className="truncate">{r.category ?? ""}</span>
                </div>
                <div
                  className="flex items-center px-1 text-[10px] text-slate-500"
                  style={{ width: W_TXT }}
                >
                  <span className="truncate">{r.phase ?? ""}</span>
                </div>
                <MoneyCell v={num(r.budget_revised)} />
                <MoneyCell v={num(r.spend)} />
                <MoneyCell v={num(r.remaining)} />
                <MoneyCell v={num(r.forecast)} />
                <MoneyCell v={num(r.forecast) - num(r.spend)} />
              </div>
            );
          })}
        </div>

        {/* Panel de columnas de tiempo (scroll horizontal virtualizado) */}
        <div ref={rightPane} className="grow overflow-x-auto">
          <div style={{ width: totalW, position: "relative" }}>
            {/* Cabecera de dos niveles: grupo (mes/trimestre/año) sobre columna */}
            <div
              className="sticky top-0 z-10 border-b border-slate-200 bg-slate-100"
              style={{ height: HDR_H }}
            >
              {/* Nivel superior — pocos grupos, sin virtualizar */}
              {tops.map((g) => (
                <div
                  key={g.key}
                  className="absolute top-0 flex items-center justify-center border-r border-slate-200 text-[10px] font-semibold text-slate-600"
                  style={{
                    left: g.startIndex * colW,
                    width: g.span * colW,
                    height: HDR_H / 2,
                  }}
                >
                  {g.label}
                </div>
              ))}
              {/* Nivel inferior — columnas virtualizadas */}
              {virtualCols.map((vc) => {
                const col = columns[vc.index];
                const w = col.weeks[0];
                const day = view === "week" && w ? new Date(`${w}T00:00:00`).getUTCDate() : null;
                return (
                  <div
                    key={col.key}
                    className="absolute flex items-center justify-center border-r border-t border-slate-200 text-center text-[11px] font-medium text-slate-600"
                    style={{
                      left: vc.start,
                      width: vc.size,
                      top: HDR_H / 2,
                      height: HDR_H / 2,
                    }}
                  >
                    {day != null ? String(day) : col.label}
                  </div>
                );
              })}
            </div>

            {/* Filas */}
            {displayRows.map((row) => {
              const h = rowHeight(row.kind);
              if (row.kind === "cat") {
                return (
                  <div
                    key={`R-cat-${row.category}`}
                    className="border-b border-t-2 border-slate-300 border-t-slate-400 bg-[#EAF0FA]"
                    style={{ height: h }}
                  />
                );
              }
              if (row.kind === "total" || row.kind === "grand") {
                const bg = row.kind === "grand" ? "bg-[#C8DCF0]" : "bg-[#DCE6F4]";
                const border =
                  row.kind === "grand"
                    ? "border-t-2 border-slate-800"
                    : "border-y-2 border-slate-500";
                return (
                  <div
                    key={row.kind === "grand" ? "R-grand" : `R-tot-${row.category}`}
                    className={`relative ${bg} ${border}`}
                    style={{ height: h }}
                  >
                    {virtualCols.map((vc) => {
                      const col = columns[vc.index];
                      const v = colSum(row.lines, col.weeks);
                      return (
                        <div
                          key={col.key}
                          className="tabular absolute top-0 flex h-full items-center justify-center border-r border-slate-200 text-center text-[10px] font-semibold"
                          style={{ left: vc.start, width: vc.size }}
                        >
                          {compact(v)}
                        </div>
                      );
                    })}
                  </div>
                );
              }
              const r = row.r;
              return (
                <div
                  key={r.id}
                  className="relative border-b border-slate-100"
                  style={{ height: h }}
                >
                  {virtualCols.map((vc) => {
                    const col = columns[vc.index];
                    const isWeek = view === "week";
                    const cell = isWeek ? index.get(r.id)?.get(col.key) : undefined;
                    const value = isWeek
                      ? (cell?.amount ?? 0)
                      : columnTotal(index, r.id, col.weeks);
                    const bg =
                      isWeek && cell ? (stateColor.get(cell.state_id) ?? undefined) : undefined;
                    const isSel = selected?.wbsId === r.id && selected?.week === col.key;
                    return (
                      <button
                        type="button"
                        key={col.key}
                        disabled={!isWeek || !canEdit}
                        onClick={() =>
                          isWeek && canEdit && setSelected({ wbsId: r.id, week: col.key })
                        }
                        className={`tabular absolute top-0 h-full border-r border-slate-100 text-center text-[11px] ${
                          isWeek && canEdit
                            ? "cursor-pointer hover:ring-1 hover:ring-slate-400"
                            : ""
                        } ${isSel ? "ring-2 ring-slate-900" : ""}`}
                        style={{
                          left: vc.start,
                          width: vc.size,
                          backgroundColor: bg ? `${bg}33` : undefined,
                          color: value ? "#0f172a" : "#cbd5e1",
                        }}
                      >
                        {compact(value)}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Columna fija FULL Year (suma de todo el horizonte por línea) */}
        <div className="shrink-0 border-l border-slate-200" style={{ width: YEAR_W }}>
          <div
            className="sticky top-0 z-20 flex items-end justify-end border-b border-slate-200 bg-[#1a7f4b] px-2 pb-1 text-right text-[10px] font-semibold uppercase text-white"
            style={{ height: HDR_H }}
          >
            FULL Year
          </div>
          {displayRows.map((row) => {
            const h = rowHeight(row.kind);
            if (row.kind === "cat") {
              return (
                <div
                  key={`Y-cat-${row.category}`}
                  className="border-b border-t-2 border-slate-300 border-t-slate-400 bg-[#EAF0FA]"
                  style={{ height: h }}
                />
              );
            }
            const total =
              row.kind === "line"
                ? columnTotal(index, row.r.id, weekList)
                : colSum(row.lines, weekList);
            const cls =
              row.kind === "grand"
                ? "bg-[#1a7f4b] text-white border-t-2 border-slate-800"
                : row.kind === "total"
                  ? "bg-[#cfe0f3] font-semibold border-y-2 border-slate-500"
                  : "bg-[#eef2f9] border-b border-slate-100";
            const key =
              row.kind === "line"
                ? `Y-${row.r.id}`
                : row.kind === "total"
                  ? `Y-tot-${row.category}`
                  : "Y-grand";
            return (
              <div
                key={key}
                className={`tabular flex items-center justify-end px-2 text-right text-[11px] ${cls}`}
                style={{ height: h }}
              >
                {compact(total)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
