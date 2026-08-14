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

// Columnas fijas de la izquierda (identidad + presupuesto) con su ancho, para
// CONGELARLAS (sticky) cuando se hace scroll horizontal de las semanas.
const LEFT_COLS: {
  label: string;
  w: number;
  money: boolean;
  help?: keyof typeof COL_HELP;
}[] = [
  { label: "Project Category", w: 92, money: false },
  { label: "Phases", w: 78, money: false },
  { label: "Phases Subphase", w: 78, money: false },
  { label: "WBS Number", w: 70, money: false },
  { label: "Task Title", w: 150, money: false },
  { label: "Owner", w: 78, money: false },
  { label: "Budget Revised", w: 92, money: true, help: "revised" },
  { label: "YTD Expense", w: 84, money: true, help: "spend" },
  { label: "Remaining", w: 92, money: true, help: "remaining" },
  { label: "Forecast", w: 88, money: true, help: "forecast" },
  { label: "Funding Pending", w: 96, money: true, help: "funding" },
];
const LEFT_AT = LEFT_COLS.reduce<number[]>((acc, _c, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + LEFT_COLS[i - 1].w);
  return acc;
}, []);
const FIXED = LEFT_COLS.length; // 11

// Estilo sticky de una columna izquierda (congelada). z alto en cabecera.
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

// Celda de dinero con signo $ y negativos en rojo (pedido del owner).
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

const MONEYTH = "px-2 py-2 text-right text-[10px] font-semibold uppercase whitespace-nowrap";

export function TimelineDetail() {
  const financials = useFinancials();
  const weeks = useScheduleWeeks();
  const cells = useScheduleCells();
  const tool = usePaintTool();

  // Vista consolidada de UN año (como el Excel): Q → Meses → Semanas juntos.
  const allWeeks = weeks.data?.weeks ?? [];
  const years = useMemo(() => yearsOf(allWeeks), [allWeeks]);
  // Multi-año (como Job Cost): ver 2+ años juntos. null = año por defecto.
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

  const groups = useMemo(() => {
    // La VENTA (proceeds) queda FUERA de todos los totales — va como referencia al final.
    const lines = (financials.data ?? []).filter(
      (r) => r.kind !== "section_header" && r.kind !== "proceeds",
    );
    const map = new Map<string, WbsFinancials[]>();
    for (const r of lines) {
      const key = r.category ?? "Uncategorized";
      const arr = map.get(key);
      if (arr) arr.push(r);
      else map.set(key, [r]);
    }
    // Mostrar TODAS las categorías (incluidas las vacías, ej. Construction) en el
    // orden del Excel (sort_order), aunque aún no tengan tareas cargadas.
    for (const name of tool.catOrder.keys()) {
      if (!map.has(name)) map.set(name, []);
    }
    return [...map.entries()].sort(
      (a, b) => (tool.catOrder.get(a[0]) ?? 99) - (tool.catOrder.get(b[0]) ?? 99),
    );
  }, [financials.data, tool.catOrder]);

  const allLines = useMemo(() => groups.flatMap(([, ls]) => ls), [groups]);
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
    return <p className="text-sm text-slate-500">Loading Timeline Detail…</p>;

  const colSum = (ls: WbsFinancials[], wks: string[]) =>
    ls.reduce((s, l) => s + columnTotal(index, l.id, wks), 0);
  const yearSum = (ls: WbsFinancials[]) => colSum(ls, weekList);

  return (
    <div>
      <PrintBar title="Timeline Detail" subtitle={`Years: ${activeYears.join(", ")}`} />
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
          {allLines.length} tasks · {activeYears.join(", ")}
        </span>
        <PaintToolbar tool={tool} />
      </div>

      <div className="max-h-[74vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table
          className="border-collapse text-[11px]"
          style={{ userSelect: tool.paintOn ? "none" : "auto" }}
        >
          <thead className="sticky top-0 z-30 bg-[#434343] text-left text-white">
            {/* Fila 1 — Trimestres */}
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
                label="Full Year"
                help={COL_HELP.fullyear}
                className="border border-slate-600 bg-[#2d3a5c] px-2 text-right text-[10px] uppercase"
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
            {groups.map(([category, ls]) => {
              const sub = zero();
              for (const r of ls) add(sub, r);
              return (
                <TimelineDetailGroup
                  key={category}
                  category={category}
                  lines={ls}
                  sub={sub}
                  columns={columns}
                  index={index}
                  weekList={weekList}
                  colSum={colSum}
                  yearSum={yearSum}
                  tool={tool}
                />
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-20">
            <tr className="border-t-2 border-slate-800 bg-[#C8DCF0] font-bold">
              <td
                className="border border-slate-300 bg-[#C8DCF0] px-2 py-2"
                colSpan={6}
                style={{ position: "sticky", left: 0, zIndex: 21 }}
              >
                PROJECT TOTAL
              </td>
              <td
                className="tabular border border-slate-300 bg-[#C8DCF0] px-2 py-2 text-right"
                style={leftStyle(6, 21)}
              >
                {moneyCell(grand.rev)}
              </td>
              <td
                className="tabular border border-slate-300 bg-[#C8DCF0] px-2 py-2 text-right"
                style={leftStyle(7, 21)}
              >
                {moneyCell(grand.spend)}
              </td>
              <td
                className="tabular border border-slate-300 bg-[#C8DCF0] px-2 py-2 text-right"
                style={leftStyle(8, 21)}
              >
                {moneyCell(grand.rem)}
              </td>
              <td
                className="tabular border border-slate-300 bg-[#C8DCF0] px-2 py-2 text-right"
                style={leftStyle(9, 21)}
              >
                {moneyCell(grand.fc)}
              </td>
              <td
                className="tabular border border-slate-300 bg-[#C8DCF0] px-2 py-2 text-right"
                style={leftStyle(10, 21)}
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
              <td className="tabular bg-[#2d3a5c] px-2 py-2 text-right text-white">
                {gridCell(yearSum(allLines))}
              </td>
            </tr>
            {/* VENTA como referencia — FUERA de los totales de arriba */}
            {proceedsLines.map((p) => (
              <tr key={`ref-${p.id}`} className="bg-emerald-50 text-[11px] italic text-emerald-900">
                <td
                  className="border border-emerald-200 bg-emerald-50 px-2 py-1.5"
                  colSpan={6}
                  style={{ position: "sticky", left: 0, zIndex: 21 }}
                >
                  ↓ Reference — {p.wbs_code} {p.title} (sale, NOT in totals)
                </td>
                <td
                  className="tabular border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-right font-semibold"
                  style={leftStyle(6, 21)}
                >
                  {moneyCell(Number(p.budget_revised))}
                </td>
                <td colSpan={columns.length + 5} className="bg-emerald-50" />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function TimelineDetailGroup({
  category,
  lines,
  sub,
  columns,
  index,
  weekList,
  colSum,
  yearSum,
  tool,
}: {
  category: string;
  lines: WbsFinancials[];
  sub: Sums;
  columns: ReturnType<typeof buildColumns>;
  index: ReturnType<typeof indexCells>;
  weekList: string[];
  colSum: (ls: WbsFinancials[], wks: string[]) => number;
  yearSum: (ls: WbsFinancials[]) => number;
  tool: PaintTool;
}) {
  const sumsOf = (ls: WbsFinancials[]): Sums => ({
    rev: ls.reduce((s, l) => s + num(l.budget_revised), 0),
    spend: ls.reduce((s, l) => s + num(l.spend), 0),
    rem: ls.reduce((s, l) => s + num(l.remaining), 0),
    fc: ls.reduce((s, l) => s + num(l.forecast), 0),
    funding: ls.reduce((s, l) => s + (num(l.forecast) - num(l.spend)), 0),
  });
  // Fila de subtotal de categoría (reutilizable: TOTAL, o TOTAL GASTOS / TOTAL VENTA).
  // La VENTA se aísla en verde con borde propio para diferenciarla de los gastos.
  const catTotal = (label: string, s: Sums, ls: WbsFinancials[], key: string, venta = false) => {
    const bg = venta ? "bg-[#DFF3E3]" : "bg-[#DCE6F4]";
    const bd = venta ? "border-emerald-600" : "border-slate-500";
    return (
      <tr key={key} className={`border-y-2 ${bd} ${bg} text-[12px] font-bold`}>
        <td
          className={`border border-slate-300 ${bg} px-2 py-1.5 text-right`}
          colSpan={6}
          style={{ position: "sticky", left: 0, zIndex: 9 }}
        >
          {label}
        </td>
        <td
          className={`tabular border border-slate-300 ${bg} px-2 text-right`}
          style={leftStyle(6, 9)}
        >
          {moneyCell(s.rev)}
        </td>
        <td
          className={`tabular border border-slate-300 ${bg} px-2 text-right`}
          style={leftStyle(7, 9)}
        >
          {moneyCell(s.spend)}
        </td>
        <td
          className={`tabular border border-slate-300 ${bg} px-2 text-right`}
          style={leftStyle(8, 9)}
        >
          {moneyCell(s.rem)}
        </td>
        <td
          className={`tabular border border-slate-300 ${bg} px-2 text-right`}
          style={leftStyle(9, 9)}
        >
          {moneyCell(s.fc)}
        </td>
        <td
          className={`tabular border border-slate-300 ${bg} px-2 text-right`}
          style={leftStyle(10, 9)}
        >
          {moneyCell(s.funding)}
        </td>
        {columns.map((c) => (
          <td key={c.key} className="tabular border border-slate-200 px-1 text-center text-[10px]">
            {gridCell(colSum(ls, c.weeks))}
          </td>
        ))}
        <td className="tabular bg-[#cfe0f3] px-2 text-right">{gridCell(yearSum(ls))}</td>
      </tr>
    );
  };
  const sales = lines.filter((l) => l.kind === "proceeds");
  const costs = lines.filter((l) => l.kind !== "proceeds");
  return (
    <>
      <tr className="border-t-2 border-slate-400 bg-[#EAF0FA]">
        <td
          className="border border-slate-300 bg-[#EAF0FA] px-2 py-1.5 text-[12px] font-bold uppercase text-slate-800"
          colSpan={FIXED}
          style={{ position: "sticky", left: 0, zIndex: 9 }}
        >
          <CategoryHead tool={tool} category={category} />
        </td>
        <td colSpan={columns.length + 1} className="bg-[#EAF0FA]" />
      </tr>
      {/* La línea de venta (proceeds) NO se lista — va solo en TOTAL VENTA. */}
      {costs.map((r) => {
        const funding = num(r.forecast) - num(r.spend);
        const row = index.get(r.id);
        return (
          <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
            <td
              className="border border-slate-200 bg-white px-2 text-slate-500"
              style={leftStyle(0)}
            >
              {cleanCatName(r.category ?? "")}
            </td>
            <td
              className="border border-slate-200 bg-white px-2 text-slate-500"
              style={leftStyle(1)}
            >
              {r.phase ?? ""}
            </td>
            <td
              className="border border-slate-200 bg-white px-2 text-slate-400"
              style={leftStyle(2)}
            >
              —
            </td>
            <td
              className="whitespace-nowrap border border-slate-200 bg-white px-2 font-mono text-[10px] text-slate-500"
              style={leftStyle(3)}
            >
              {r.wbs_code}
            </td>
            <td
              className="truncate border border-slate-200 bg-white px-2"
              style={leftStyle(4)}
              title={r.title}
            >
              {r.title}
            </td>
            <td
              className="border border-slate-200 bg-white px-2 text-slate-500"
              style={leftStyle(5)}
            >
              {r.owner ?? ""}
            </td>
            <td
              className="tabular border border-slate-200 bg-white px-2 text-right font-medium"
              style={leftStyle(6)}
            >
              {moneyCell(r.budget_revised)}
            </td>
            <td
              className="tabular border border-slate-200 bg-white px-2 text-right text-slate-600"
              style={leftStyle(7)}
            >
              {moneyCell(r.spend)}
            </td>
            <td
              className={`tabular border border-slate-200 bg-white px-2 text-right ${num(r.remaining) < 0 ? "text-red-600" : ""}`}
              style={leftStyle(8)}
            >
              {moneyCell(r.remaining)}
            </td>
            <td
              className="tabular border border-slate-200 bg-white px-2 text-right"
              style={leftStyle(9)}
            >
              {moneyCell(r.forecast)}
            </td>
            <td
              className={`tabular border border-slate-200 bg-white px-2 text-right ${funding < 0 ? "text-red-600" : ""}`}
              style={leftStyle(10)}
            >
              {moneyCell(funding)}
            </td>
            {columns.map((c) => {
              const week = c.weeks[0];
              const cell = week ? row?.get(week) : undefined;
              const bg = tool.cellBg(r.category ?? "", !!cell);
              const amt = columnTotal(index, r.id, c.weeks);
              return (
                <td
                  key={c.key}
                  className={`tabular border border-slate-200 px-1 text-center text-[10px] ${tool.paintOn ? "cursor-crosshair" : ""}`}
                  // Con cifra, se atenúa el color (50% hacia blanco) para leer el número.
                  style={{ backgroundColor: bg ? (amt ? softenHex(bg) : bg) : undefined }}
                  {...(week
                    ? tool.cellPaint(() => tool.paintCell(r.id, week, cell?.amount ?? null))
                    : {})}
                >
                  {amt ? gridCell(amt) : null}
                </td>
              );
            })}
            <td className="tabular bg-[#eef2f9] px-2 text-right font-medium">
              {gridCell(columnTotal(index, r.id, weekList))}
            </td>
          </tr>
        );
      })}
      {sales.length === 0
        ? catTotal(`TOTAL ${cleanCatName(category)}`, sub, lines, `tot-${category}`)
        : [
            catTotal("TOTAL EXPENSES", sumsOf(costs), costs, `totg-${category}`),
            catTotal(
              `TOTAL SALE · ${sales.map((l) => l.wbs_code).join(", ")}`,
              sumsOf(sales),
              sales,
              `totv-${category}`,
              true,
            ),
          ]}
    </>
  );
}
