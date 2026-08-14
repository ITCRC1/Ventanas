"use client";

import { PrintBar } from "@/components/PrintBar";
import { COL_HELP, ColHead } from "@/lib/colhelp";
import { moneyUsd, num } from "@/lib/format";
import { useFinancials, useScheduleCells, useScheduleWeeks } from "@/lib/hooks";
import {
  CategoryHead,
  type PaintTool,
  PaintToolbar,
  cleanCatName,
  softenHex,
  usePaintTool,
} from "@/lib/paint";
import {
  type View,
  buildColumns,
  colBands,
  columnTotal,
  indexCells,
  weekDay,
  yearsOf,
} from "@/lib/schedule";
import type { WbsFinancials } from "@/lib/types";
import { type CSSProperties, type ReactNode, useMemo, useState } from "react";

// Columnas fijas de la izquierda (identidad + presupuesto), congeladas (sticky).
const LEFT_COLS: {
  label: string;
  w: number;
  money: boolean;
  help?: keyof typeof COL_HELP;
}[] = [
  { label: "Project Category", w: 110, money: false },
  { label: "Phases", w: 96, money: false },
  { label: "Budget Revised", w: 100, money: true, help: "revised" },
  { label: "YTD Expense", w: 92, money: true, help: "spend" },
  { label: "Remaining", w: 100, money: true, help: "remaining" },
  { label: "Forecast", w: 96, money: true, help: "forecast" },
  { label: "Funding Pending", w: 104, money: true, help: "funding" },
];
const LEFT_AT = LEFT_COLS.reduce<number[]>((acc, _c, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + LEFT_COLS[i - 1].w);
  return acc;
}, []);
const FIXED = LEFT_COLS.length; // 7

function leftStyle(i: number, z = 11): CSSProperties {
  return {
    position: "sticky",
    left: LEFT_AT[i],
    width: LEFT_COLS[i].w,
    minWidth: LEFT_COLS[i].w,
    zIndex: z,
  };
}

// Compacto: $ + K/M en MAYÚSCULA y NEGRITA; hover = cifra completa; neg en rojo.
function gridCell(n: number): ReactNode {
  if (!n) return <span className="text-slate-300">·</span>;
  const a = Math.abs(n);
  const neg = n < 0;
  let body: ReactNode;
  if (a >= 1_000_000)
    body = (
      <>
        {(a / 1_000_000).toFixed(2)}
        <b>M</b>
      </>
    );
  else if (a >= 1000)
    body = (
      <>
        {(a / 1000).toFixed(2)}
        <b>K</b>
      </>
    );
  else body = String(Math.round(a));
  return (
    <span
      title={n.toLocaleString("en-US", { style: "currency", currency: "USD" })}
      className={neg ? "text-red-600" : undefined}
    >
      {neg ? "($" : "$"}
      {body}
      {neg ? ")" : ""}
    </span>
  );
}

// Dinero con signo $ y negativos en rojo (pedido del owner).
function moneyCell(v: string | number): ReactNode {
  const n = num(v);
  return <span className={n < 0 ? "text-red-600" : undefined}>{moneyUsd(n)}</span>;
}

interface Sums {
  rev: number;
  spend: number;
  rem: number;
  fc: number;
  funding: number;
}
const zero = (): Sums => ({ rev: 0, spend: 0, rem: 0, fc: 0, funding: 0 });
function add(s: Sums, r: WbsFinancials): void {
  s.rev += num(r.budget_revised);
  s.spend += num(r.spend);
  s.rem += num(r.remaining);
  s.fc += num(r.forecast);
  s.funding += num(r.forecast) - num(r.spend);
}

// Fila del roll-up: una fase dentro de una categoría, con las líneas WBS que agrupa.
interface PhaseRow {
  phase: string;
  lines: WbsFinancials[];
  sums: Sums;
}
interface CategoryGroup {
  category: string;
  phases: PhaseRow[];
  lines: WbsFinancials[];
  sums: Sums;
}

const MONEYTH = "px-2 py-2 text-right text-[10px] font-semibold uppercase whitespace-nowrap";

export function Timeline() {
  const financials = useFinancials();
  const weeks = useScheduleWeeks();
  const cells = useScheduleCells();
  const tool = usePaintTool();

  // Vista consolidada de UN año (como el Excel): Q → Meses → Semanas juntos.
  const allWeeks = weeks.data?.weeks ?? [];
  const years = useMemo(() => yearsOf(allWeeks), [allWeeks]);
  // Multi-año (como Job Cost): se pueden ver 2+ años juntos. null = año por defecto.
  const [selYears, setSelYears] = useState<number[] | null>(null);
  const defaultYear = years.includes(2026) ? 2026 : (years[0] ?? 2026);
  const activeYears = useMemo(
    () => (selYears?.length ? selYears : [defaultYear]),
    [selYears, defaultYear],
  );
  const toggleYear = (y: number) => {
    const cur = selYears?.length ? selYears : [defaultYear];
    const next = cur.includes(y) ? cur.filter((x) => x !== y) : [...cur, y].sort((a, b) => a - b);
    setSelYears(next.length ? next : [defaultYear]);
  };

  // Filtro de año(s) + granularidad (semana / mes / trimestre).
  const [view, setView] = useState<View>("month");
  const weekList = useMemo(
    () => allWeeks.filter((w) => activeYears.includes(Number(w.slice(0, 4)))),
    [allWeeks, activeYears],
  );
  const columns = useMemo(() => buildColumns(weekList, view), [weekList, view]);
  const qBands = useMemo(() => colBands(columns, "quarter"), [columns]);
  const mBands = useMemo(() => colBands(columns, "month"), [columns]);
  const nHeaderRows = view === "week" ? 3 : view === "month" ? 2 : 1;
  const index = useMemo(() => indexCells(cells.data ?? []), [cells.data]);

  // Agrega por categoría → fase (Timeline = vista por categoría + fase).
  const groups = useMemo<CategoryGroup[]>(() => {
    // La VENTA (proceeds) queda FUERA de todos los totales — va como referencia al final.
    const lines = (financials.data ?? []).filter(
      (r) => r.kind !== "section_header" && r.kind !== "proceeds",
    );
    const byCat = new Map<string, Map<string, WbsFinancials[]>>();
    for (const r of lines) {
      const cat = r.category ?? "Uncategorized";
      const ph = r.phase ?? "No phase";
      let phases = byCat.get(cat);
      if (!phases) {
        phases = new Map();
        byCat.set(cat, phases);
      }
      const arr = phases.get(ph);
      if (arr) arr.push(r);
      else phases.set(ph, [r]);
    }
    return [...byCat.entries()].map(([category, phases]) => {
      const catLines: WbsFinancials[] = [];
      const catSums = zero();
      const phaseRows: PhaseRow[] = [];
      for (const [phase, ls] of phases.entries()) {
        // La venta (proceeds) NO va en la fila de fase — solo en TOTAL VENTA.
        const costLs = ls.filter((r) => r.kind !== "proceeds");
        const sums = zero();
        for (const r of costLs) add(sums, r);
        for (const r of ls) {
          add(catSums, r);
          catLines.push(r);
        }
        if (costLs.length > 0) phaseRows.push({ phase, lines: costLs, sums });
      }
      return { category, phases: phaseRows, lines: catLines, sums: catSums };
    });
  }, [financials.data]);

  // Orden del Excel + mostrar TODAS las categorías (incluidas las vacías, ej.
  // Construction) para que aparezcan en su lugar aunque aún no tengan tareas.
  const orderedGroups = useMemo(() => {
    const present = new Set(groups.map((g) => g.category));
    const empties: CategoryGroup[] = [...tool.catOrder.keys()]
      .filter((name) => !present.has(name))
      .map((category) => ({ category, phases: [], lines: [], sums: zero() }));
    return [...groups, ...empties].sort(
      (a, b) => (tool.catOrder.get(a.category) ?? 99) - (tool.catOrder.get(b.category) ?? 99),
    );
  }, [groups, tool.catOrder]);

  const allLines = useMemo(() => groups.flatMap((g) => g.lines), [groups]);
  const proceedsLines = useMemo(
    () => (financials.data ?? []).filter((r) => r.kind === "proceeds"),
    [financials.data],
  );
  const grand = useMemo(() => {
    const s = zero();
    for (const r of allLines) add(s, r);
    return s;
  }, [allLines]);

  if (financials.isLoading || weeks.isLoading)
    return <p className="text-sm text-slate-500">Loading Timeline…</p>;

  const colSum = (ls: WbsFinancials[], wks: string[]) =>
    ls.reduce((s, l) => s + columnTotal(index, l.id, wks), 0);
  const yearSum = (ls: WbsFinancials[]) => colSum(ls, weekList);

  return (
    <div>
      <PrintBar title="Timeline" subtitle={`Years: ${activeYears.join(", ")}`} />
      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <span
          className="text-sm text-slate-500"
          title="You can select more than one year to view them together"
        >
          Years:
        </span>
        {years.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => toggleYear(y)}
            className={`rounded px-3 py-1 text-sm ${
              activeYears.includes(y)
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {y}
          </button>
        ))}
        {activeYears.length > 1 ? (
          <span className="text-xs text-slate-400">({activeYears.length} years together)</span>
        ) : null}
        <span className="mx-1 h-5 w-px bg-slate-300" />
        <span className="text-sm text-slate-500">View by:</span>
        {(["week", "month", "quarter"] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded px-3 py-1 text-sm ${
              view === v
                ? "bg-slate-900 text-white"
                : "border border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {v === "week" ? "Weekly" : v === "month" ? "Monthly" : "Quarterly"}
          </button>
        ))}
        <span className="ml-2 text-xs text-slate-400">
          {groups.length} categories · {activeYears.join(", ")}
        </span>
        <PaintToolbar tool={tool} />
      </div>

      <div className="max-h-[74vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table
          className="border-collapse text-[11px]"
          style={{ userSelect: tool.paintOn ? "none" : "auto" }}
        >
          <thead className="sticky top-0 z-20 bg-[#434343] text-left text-white">
            {/* Fila 1 — Trimestres (o los propios trimestres si view=trimestre) */}
            <tr>
              {LEFT_COLS.map((c, i) =>
                c.help ? (
                  <ColHead
                    key={c.label}
                    label={c.label}
                    help={COL_HELP[c.help]}
                    className={`border border-slate-600 bg-[#434343] ${MONEYTH}`}
                    style={leftStyle(i, 32)}
                    align="right"
                    rowSpan={nHeaderRows}
                  />
                ) : (
                  <th
                    key={c.label}
                    className={`border border-slate-600 bg-[#434343] ${c.money ? MONEYTH : "px-2 py-2"}`}
                    rowSpan={nHeaderRows}
                    style={leftStyle(i, 32)}
                  >
                    {c.label}
                  </th>
                ),
              )}
              {qBands.map((q) => (
                <th
                  key={q.key}
                  colSpan={q.span}
                  className="border border-slate-500 bg-[#2f2f2f] px-1 py-1 text-center text-[11px] font-bold"
                >
                  {q.label}
                </th>
              ))}
              <ColHead
                label="FULL Year"
                help={COL_HELP.fullyear}
                className="border border-slate-600 bg-[#1a7f4b] px-2 text-right text-[10px] uppercase"
                style={{ minWidth: 90 }}
                align="right"
                rowSpan={nHeaderRows}
              />
            </tr>
            {/* Fila 2 — Meses (banda) en semanal · nombres de mes en mensual */}
            {view !== "quarter" ? (
              <tr>
                {view === "week"
                  ? mBands.map((mo) => (
                      <th
                        key={mo.key}
                        colSpan={mo.span}
                        className="border border-slate-500 px-1 py-1 text-center text-[10px] font-semibold"
                      >
                        {mo.label}
                      </th>
                    ))
                  : columns.map((c) => (
                      <th
                        key={c.key}
                        className="border border-slate-500 px-1 py-1 text-center text-[10px] font-semibold"
                        style={{ minWidth: 44 }}
                      >
                        {c.label}
                      </th>
                    ))}
              </tr>
            ) : null}
            {/* Fila 3 — Semanas (día del mes), solo en vista semanal */}
            {view === "week" ? (
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className="border border-slate-500 px-1 py-1 text-center text-[9px] font-normal text-slate-200"
                    style={{ minWidth: 34 }}
                  >
                    {weekDay(c)}
                  </th>
                ))}
              </tr>
            ) : null}
          </thead>
          <tbody>
            {orderedGroups.map((g) => (
              <TimelineGroup
                key={g.category}
                group={g}
                columns={columns}
                colSum={colSum}
                yearSum={yearSum}
                index={index}
                tool={tool}
              />
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 z-10">
            <tr className="border-t-2 border-slate-800 bg-[#C8DCF0] font-bold">
              <td
                className="border border-slate-300 bg-[#C8DCF0] px-2 py-2"
                colSpan={2}
                style={{ position: "sticky", left: 0, zIndex: 21 }}
              >
                PROJECT TOTAL
              </td>
              <td
                className="tabular border border-slate-300 bg-[#C8DCF0] px-2 py-2 text-right"
                style={leftStyle(2, 21)}
              >
                {moneyCell(grand.rev)}
              </td>
              <td
                className="tabular border border-slate-300 bg-[#C8DCF0] px-2 py-2 text-right"
                style={leftStyle(3, 21)}
              >
                {moneyCell(grand.spend)}
              </td>
              <td
                className="tabular border border-slate-300 bg-[#C8DCF0] px-2 py-2 text-right"
                style={leftStyle(4, 21)}
              >
                {moneyCell(grand.rem)}
              </td>
              <td
                className="tabular border border-slate-300 bg-[#C8DCF0] px-2 py-2 text-right"
                style={leftStyle(5, 21)}
              >
                {moneyCell(grand.fc)}
              </td>
              <td
                className="tabular border border-slate-300 bg-[#C8DCF0] px-2 py-2 text-right"
                style={leftStyle(6, 21)}
              >
                {moneyCell(grand.funding)}
              </td>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className="tabular border border-slate-200 px-1 py-2 text-center text-[10px]"
                >
                  {gridCell(colSum(allLines, c.weeks))}
                </td>
              ))}
              <td className="tabular bg-[#1a7f4b] px-2 py-2 text-right text-white">
                {gridCell(yearSum(allLines))}
              </td>
            </tr>
            {/* VENTA como referencia — FUERA de los totales de arriba */}
            {proceedsLines.map((p) => (
              <tr key={`ref-${p.id}`} className="bg-emerald-50 text-[11px] italic text-emerald-900">
                <td
                  className="border border-emerald-200 bg-emerald-50 px-2 py-1.5"
                  colSpan={2}
                  style={{ position: "sticky", left: 0, zIndex: 21 }}
                >
                  ↓ Reference — {p.title} (sale, NOT in totals)
                </td>
                <td
                  className="tabular border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-right font-semibold"
                  style={leftStyle(2, 21)}
                >
                  {moneyCell(Number(p.budget_revised))}
                </td>
                <td colSpan={columns.length + 4} className="bg-emerald-50" />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ¿Alguna WBS de la fase tiene celda marcada esa semana? (para pintar el roll-up).
function phaseHasCell(
  index: ReturnType<typeof indexCells>,
  lines: WbsFinancials[],
  week: string,
): boolean {
  for (const l of lines) {
    if (index.get(l.id)?.get(week)) return true;
  }
  return false;
}

function TimelineGroup({
  group,
  columns,
  colSum,
  yearSum,
  index,
  tool,
}: {
  group: CategoryGroup;
  columns: ReturnType<typeof buildColumns>;
  colSum: (ls: WbsFinancials[], wks: string[]) => number;
  yearSum: (ls: WbsFinancials[]) => number;
  index: ReturnType<typeof indexCells>;
  tool: PaintTool;
}) {
  const g = group;
  const sumsOf = (ls: WbsFinancials[]): Sums => {
    const s = zero();
    for (const r of ls) add(s, r);
    return s;
  };
  // Fila de subtotal de categoría (reutilizable: TOTAL, o TOTAL GASTOS / TOTAL VENTA).
  // La VENTA se aísla en verde con borde propio para diferenciarla de los gastos.
  const catTotal = (
    label: string,
    sums: Sums,
    lines: WbsFinancials[],
    key: string,
    venta = false,
  ) => {
    const bg = venta ? "bg-[#DFF3E3]" : "bg-[#DCE6F4]";
    const bd = venta ? "border-emerald-600" : "border-slate-500";
    return (
      <tr key={key} className={`border-y-2 ${bd} ${bg} text-[12px] font-bold`}>
        <td
          className={`border border-slate-300 ${bg} px-2 py-1.5 text-right`}
          colSpan={2}
          style={{ position: "sticky", left: 0, zIndex: 9 }}
        >
          {label}
        </td>
        <td
          className={`tabular border border-slate-300 ${bg} px-2 text-right`}
          style={leftStyle(2, 9)}
        >
          {moneyCell(sums.rev)}
        </td>
        <td
          className={`tabular border border-slate-300 ${bg} px-2 text-right`}
          style={leftStyle(3, 9)}
        >
          {moneyCell(sums.spend)}
        </td>
        <td
          className={`tabular border border-slate-300 ${bg} px-2 text-right`}
          style={leftStyle(4, 9)}
        >
          {moneyCell(sums.rem)}
        </td>
        <td
          className={`tabular border border-slate-300 ${bg} px-2 text-right`}
          style={leftStyle(5, 9)}
        >
          {moneyCell(sums.fc)}
        </td>
        <td
          className={`tabular border border-slate-300 ${bg} px-2 text-right`}
          style={leftStyle(6, 9)}
        >
          {moneyCell(sums.funding)}
        </td>
        {columns.map((c) => (
          <td key={c.key} className="tabular border border-slate-200 px-1 text-center text-[10px]">
            {gridCell(colSum(lines, c.weeks))}
          </td>
        ))}
        <td className="tabular bg-[#cfe0f3] px-2 text-right">{gridCell(yearSum(lines))}</td>
      </tr>
    );
  };
  const sales = g.lines.filter((l) => l.kind === "proceeds");
  const costs = g.lines.filter((l) => l.kind !== "proceeds");
  return (
    <>
      <tr className="border-t-2 border-slate-400 bg-[#EAF0FA]">
        <td
          className="border border-slate-300 bg-[#EAF0FA] px-2 py-1.5 text-[12px] font-bold uppercase text-slate-800"
          colSpan={FIXED}
          style={{ position: "sticky", left: 0, zIndex: 9 }}
        >
          <CategoryHead tool={tool} category={g.category} />
        </td>
        <td colSpan={columns.length + 1} className="bg-[#EAF0FA]" />
      </tr>
      {g.phases.map((p) => (
        <tr key={p.phase} className="border-b border-slate-100 hover:bg-slate-50">
          <td className="border border-slate-200 bg-white px-2 text-slate-400" style={leftStyle(0)}>
            {cleanCatName(g.category)}
          </td>
          <td
            className="border border-slate-200 bg-white px-2 font-medium text-slate-700"
            style={leftStyle(1)}
          >
            {p.phase}
          </td>
          <td
            className="tabular border border-slate-200 bg-white px-2 text-right font-medium"
            style={leftStyle(2)}
          >
            {moneyCell(p.sums.rev)}
          </td>
          <td
            className="tabular border border-slate-200 bg-white px-2 text-right text-slate-600"
            style={leftStyle(3)}
          >
            {moneyCell(p.sums.spend)}
          </td>
          <td
            className={`tabular border border-slate-200 bg-white px-2 text-right ${p.sums.rem < 0 ? "text-red-600" : ""}`}
            style={leftStyle(4)}
          >
            {moneyCell(p.sums.rem)}
          </td>
          <td
            className="tabular border border-slate-200 bg-white px-2 text-right"
            style={leftStyle(5)}
          >
            {moneyCell(p.sums.fc)}
          </td>
          <td
            className={`tabular border border-slate-200 bg-white px-2 text-right ${p.sums.funding < 0 ? "text-red-600" : ""}`}
            style={leftStyle(6)}
          >
            {moneyCell(p.sums.funding)}
          </td>
          {columns.map((c) => {
            const week = c.weeks[0];
            const bg = week
              ? tool.cellBg(g.category, phaseHasCell(index, p.lines, week))
              : undefined;
            const v = colSum(p.lines, c.weeks);
            return (
              <td
                key={c.key}
                className={`tabular border border-slate-200 px-1 text-center text-[10px] ${tool.paintOn ? "cursor-crosshair" : ""}`}
                // Con cifra, se atenúa el color (50% hacia blanco) para leer el número.
                style={{ backgroundColor: bg ? (v ? softenHex(bg) : bg) : undefined }}
                {...(week
                  ? tool.cellPaint(() => {
                      for (const l of p.lines)
                        tool.paintCell(l.id, week, index.get(l.id)?.get(week)?.amount ?? null);
                    })
                  : {})}
              >
                {gridCell(v)}
              </td>
            );
          })}
          <td className="tabular bg-[#eef2f9] px-2 text-right font-medium">
            {gridCell(yearSum(p.lines))}
          </td>
        </tr>
      ))}
      {sales.length === 0
        ? catTotal(`TOTAL ${cleanCatName(g.category)}`, g.sums, g.lines, `tot-${g.category}`)
        : [
            catTotal("TOTAL EXPENSES", sumsOf(costs), costs, `totg-${g.category}`),
            catTotal(
              `TOTAL SALE · ${sales.map((l) => l.wbs_code).join(", ")}`,
              sumsOf(sales),
              sales,
              `totv-${g.category}`,
              true,
            ),
          ]}
    </>
  );
}
