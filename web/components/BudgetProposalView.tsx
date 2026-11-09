"use client";

// Presupuesto anual por semana, con el JOB COST como estándar.
//
// Regla de la pantalla: **ninguna línea del Job Cost queda afuera.** Las 78
// salen, tengan remanente o no. Una línea que no aparece es una línea que nadie
// revisa, y en un presupuesto eso es justo lo que no se puede permitir.
//
// El remanente de cada línea se parte en cuatro tramos que tienen que sumarlo:
//   VENCIDO    la semana ya pasó y sigue sin gastarse
//   ARRASTRE   de hoy a fin del año en curso
//   PLAN       dentro del año que se presupuesta
//   POSTERIOR  más adelante
// y la propuesta es VENCIDO + ARRASTRE + PLAN. El control "sin ubicar" avisa si
// queda remanente que el cronograma no pone en ningún año.
//
// ⚠️ TRES SUB-TABS, no una tabla de sesenta columnas.
//
// Owner, 2026-11-08: *«quiero que haya varios sub tabs dentro del tab para
// hacerlo fácil de leer»*. Antes esto era el bloque de plata y las 52 semanas
// en la misma tabla: había que barrer a lo ancho para leer una línea, y el
// encabezado de mes quedaba lejos de la cifra. Ahora:
//
//   Datos      lo que la línea tiene y cómo se reparte el remanente
//   Mes a mes  enero a diciembre (o por semana, si hace falta el detalle)
//   Budget     cómo va quedando el año, por sección
//
// Las tres leen el MISMO payload y respetan el filtro de líneas cerradas, así
// que no pueden contradecirse: no hay tres cálculos, hay tres vistas.

import { Fragment, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { type BudgetProposalRow, useBudgetProposal, useMe } from "@/lib/hooks";

import { BudgetGridView } from "./BudgetGridView";

const MES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

type Vista = "datos" | "meses" | "anio" | "grid";

/** Los tramos del remanente: qué son, de dónde salen y cómo se leen por línea.
 *
 * ⚠️ `de` NO es decoración: es el único lugar donde queda escrito, para quien
 * lea la pantalla, por qué un monto vale lo que vale. Un número que no se puede
 * abrir es un número que hay que creer, y este reporte va al dueño.
 *
 * `linea` devuelve lo que esa línea aporta al tramo. La suma de los aportes
 * TIENE que dar el total de arriba — el panel lo muestra y así se puede
 * verificar sin salir de la pantalla. */
const TRAMOS = {
  remanente: {
    etq: "Job Cost remaining",
    de: "Budget Revised − Spend, line by line, from v_wbs_financials: the same view that feeds the Job Cost. It is what is left to spend.",
    linea: (f: BudgetProposalRow) => f.remaining,
    cls: "text-slate-900",
  },
  vencido: {
    etq: "Overdue (week already passed)",
    de: "Money the schedule put in a week that has already passed (after the Forecast cut-off but before today) and is still unspent. It did not vanish — it needs to be moved somewhere.",
    linea: (f: BudgetProposalRow) => f.vencido,
    cls: "text-red-700",
  },
  arrastre: {
    // ⚠️ El rotulo cambia con el año elegido, porque el numero cambia de
    // significado. El calculo es «todo lo planeado ANTES del año presupuestado
    // que todavia no paso». Con el año siguiente eso es exactamente «lo que
    // queda de este año» —son los unicos dias que caben en el medio—. Con 2028
    // son TAMBIEN los doce meses de 2027: $4,735,479 bajo un rotulo que dice
    // «this year» es una mentira de cuatro millones y medio.
    etq: "Carry-over from this year",
    de: "What the schedule holds from today to December 31 of the current year and has not been spent yet. As weeks pass without being executed this amount does NOT vanish: it migrates to «Overdue». On December 31 it reaches zero.",
    linea: (f: BudgetProposalRow) => f.arrastre,
    cls: "text-amber-700",
  },
  plan: {
    etq: "Plan",
    de: "What the schedule already holds inside the year being budgeted. It comes from schedule_cell, week by week.",
    linea: (f: BudgetProposalRow) => f.plan_total,
    cls: "text-slate-900",
  },
  posterior: {
    etq: "After",
    de: "What the schedule puts in later years. It is not part of this year's proposal, but it is shown so the remaining adds up.",
    linea: (f: BudgetProposalRow) => f.posterior,
    cls: "text-slate-500",
  },
  sin_ubicar: {
    etq: "Unplaced",
    de: "Remaining − (overdue + carry-over + plan + after). It has to be zero: if it is not, there is money pending that the schedule puts in NO year at all, and then the budget is incomplete.",
    linea: (f: BudgetProposalRow) =>
      f.remaining - (f.vencido + f.arrastre + f.plan_total + f.posterior),
    cls: "text-emerald-700",
  },
} as const;

type Tramo = keyof typeof TRAMOS;

function usd(n: number | null | undefined): string {
  if (!n) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** Los doce meses de una línea, sumando sus semanas. */
function porMes(f: BudgetProposalRow): number[] {
  const m = Array(12).fill(0) as number[];
  for (const [w, v] of Object.entries(f.propuesta ?? {})) {
    const i = Number(w.slice(5, 7)) - 1;
    if (i >= 0 && i < 12) m[i] += Number(v) || 0;
  }
  return m;
}

export function BudgetProposalView() {
  const ahora = new Date().getFullYear();
  const [anio, setAnio] = useState(ahora + 1);
  const [soloConMonto, setSoloConMonto] = useState(false);
  const [vista, setVista] = useState<Vista>("datos");
  const [porSemana, setPorSemana] = useState(false);
  const [abierto, setAbierto] = useState<Tramo | null>(null);
  const q = useBudgetProposal(anio);
  const d = q.data;
  // ⚠️ La grilla ESCRIBE. El resto de esta pantalla es de solo lectura, asi
  // que el cuarto sub-tab solo aparece para quien puede editar el
  // cronograma: mostrarselo a un viewer seria ofrecerle algo que la API le
  // va a rechazar.
  const me = useMe();
  const puedeEditar = (me.data?.permissions ?? []).includes("schedule.edit");

  const bandas = useMemo(() => {
    const out: { mes: number; desde: number; hasta: number }[] = [];
    (d?.semanas ?? []).forEach((w, i) => {
      const m = Number(w.slice(5, 7)) - 1;
      const u = out[out.length - 1];
      if (u && u.mes === m) u.hasta = i;
      else out.push({ mes: m, desde: i, hasta: i });
    });
    return out;
  }, [d?.semanas]);

  const porCat = useMemo(() => {
    const m = new Map<string, BudgetProposalRow[]>();
    for (const f of d?.filas ?? []) {
      if (soloConMonto && f.propuesta_total < 0.5 && f.remaining < 0.5) continue;
      const a = m.get(f.category);
      if (a) a.push(f);
      else m.set(f.category, [f]);
    }
    return [...m.entries()];
  }, [d?.filas, soloConMonto]);

  if (q.isLoading) return <p className="text-sm text-slate-500">Calculating the budget…</p>;
  if (q.isError || !d)
    return <p className="text-sm text-red-700">Could not calculate the budget.</p>;

  const t = d.totales;
  const mostradas = porCat.reduce((s, [, ls]) => s + ls.length, 0);
  // ⚠️ El editable va SEGUNDO, no último. Es el que se usa a diario; dejarlo al
  // final lo escondía detrás de tres vistas de solo lectura.
  //
  // Y cada uno lleva su color: antes el que no estaba activo era gris sobre
  // blanco y no se leía como un botón —el owner no los encontraba—. El de
  // edición va en azul porque es el único que ESCRIBE: conviene que se
  // distinga de un vistazo de los que solo muestran.
  const TABS: [Vista, string, string, string][] = [
    [
      "datos",
      "Line Data",
      "Budget, spent, and how the remaining splits",
      "bg-teal-600 ring-teal-700",
    ],
    ...(puedeEditar
      ? ([
          [
            "grid",
            `✎ Edit ${anio}`,
            `Edit ${anio} with ${anio - 1} beside it`,
            "bg-[#1161AA] ring-[#0E5490]",
          ],
        ] as [Vista, string, string, string][])
      : []),
    [
      "meses",
      "Month by Month",
      `The ${anio} proposal, January to December`,
      "bg-teal-600 ring-teal-700",
    ],
    [
      "anio",
      `Budget ${anio}`,
      "How the year is shaping up, by section",
      "bg-[#1161AA] ring-[#163C5E]",
    ],
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-teal-200 bg-teal-50/60">
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-teal-900">
              Year
              <select
                value={anio}
                onChange={(e) => setAnio(Number(e.target.value))}
                className="rounded border border-teal-300 bg-white px-2 py-1 text-sm font-bold text-teal-900"
              >
                {[ahora, ahora + 1, ahora + 2, ahora + 3].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-xl font-bold text-teal-900 tabular">{usd(t.propuesta)}</span>
            <span className="text-xs text-teal-700">
              {anio} proposal · {mostradas} of {t.lineas} Job Cost lines
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-teal-800">
              <input
                type="checkbox"
                checked={soloConMonto}
                onChange={(e) => setSoloConMonto(e.target.checked)}
              />
              Hide closed lines
            </label>
            <button
              type="button"
              onClick={() => void api.abrir(`/budget-proposal/export.xlsx?anio=${anio}`, true)}
              className="rounded border border-emerald-600 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            >
              ⬇ Excel
            </button>
          </div>
        </div>

        {/* Los cuatro tramos del remanente, y el control de que cierren.
            Cada uno se abre: muestra de dónde sale y qué líneas lo componen. */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-teal-200 bg-white/60 px-3 py-2 text-xs sm:grid-cols-6">
          {(
            [
              ["remanente", t.remanente],
              ["vencido", t.vencido],
              ["arrastre", t.arrastre],
              ["plan", t.plan],
              ["posterior", t.posterior],
              ["sin_ubicar", t.sin_ubicar],
            ] as [Tramo, number][]
          ).map(([k, v]) => {
            const tr = TRAMOS[k];
            const et =
              k === "plan" || k === "posterior"
                ? `${tr.etq} ${anio}`
                : k === "arrastre" && anio > ahora + 1
                  ? // Con un año lejano esto ya no es «lo que queda de este año»:
                    // son todos los años que hay en el medio. Se dice asi.
                    `Pending before ${anio}`
                  : tr.etq;
            const cls = k === "sin_ubicar" && Math.abs(v) > 5 ? "text-red-700" : tr.cls;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setAbierto(abierto === k ? null : k)}
                title="Click to see where it comes from and which lines make it up"
                className={`rounded px-1 py-0.5 text-left transition hover:bg-teal-100/70 ${
                  abierto === k ? "bg-teal-100 ring-1 ring-teal-400" : ""
                }`}
              >
                <div className="uppercase tracking-wide text-slate-400">
                  {et} <span className="text-teal-600">▾</span>
                </div>
                <div className={`tabular font-bold ${cls}`}>{usd(v)}</div>
              </button>
            );
          })}
        </div>
        {/* Mientras se edita, este parrafo solo roba alto: explica como se
            arma la PROPUESTA, no como se escribe la grilla —que tiene su propia
            ayuda arriba de la tabla—. */}
        <p
          className={`border-t border-teal-200 px-3 py-1.5 text-xs text-slate-600 ${
            vista === "grid" ? "hidden" : ""
          }`}
        >
          The <b>Job Cost is the standard</b>: each line&apos;s remaining splits across the four
          tranches and they have to add up to it &mdash; that is what <b>Unplaced</b> checks. The
          proposal is <b>overdue + carry-over + plan</b>, and whatever did not happen is parked in
          the first week of the year so it is visible and someone moves it knowingly. This screen
          changes nothing.
        </p>
      </div>

      {abierto ? (
        <Desglose
          tramo={abierto}
          anio={anio}
          filas={d.filas}
          total={d.totales[abierto === "remanente" ? "remanente" : abierto]}
          onCerrar={() => setAbierto(null)}
        />
      ) : null}

      {/* Los sub-tabs. Todas las vistas leen el mismo payload. */}
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(([k, etq, ayuda, color]) => {
          const activo = vista === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setVista(k)}
              title={ayuda}
              className={`rounded-md px-4 py-2 text-sm font-bold transition ${
                activo
                  ? `${color} text-white shadow ring-2 ring-offset-1`
                  : "bg-slate-100 text-slate-700 ring-1 ring-slate-300 hover:bg-slate-200"
              }`}
            >
              {etq}
            </button>
          );
        })}
        {vista === "meses" ? (
          <label className="ml-auto flex items-center gap-1 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={porSemana}
              onChange={(e) => setPorSemana(e.target.checked)}
            />
            By week
          </label>
        ) : null}
      </div>

      {/* La grilla trae su propio contenedor y su propio scroll: meterla dentro
          de este le pondria dos barras y dos bordes. */}
      <div
        className={
          vista === "grid"
            ? ""
            : "max-h-[68vh] overflow-auto rounded-lg border border-slate-200 bg-white"
        }
      >
        {vista === "datos" ? (
          <TablaDatos d={d} porCat={porCat} />
        ) : vista === "meses" ? (
          <TablaMeses d={d} porCat={porCat} bandas={bandas} porSemana={porSemana} />
        ) : vista === "anio" ? (
          <TablaAnio d={d} porCat={porCat} />
        ) : (
          <BudgetGridView anio={anio} />
        )}
      </div>
    </div>
  );
}

/* ── El desglose de un tramo: de dónde sale y qué líneas lo componen ────── */

function Desglose({
  tramo,
  anio,
  filas,
  total,
  onCerrar,
}: {
  tramo: Tramo;
  anio: number;
  filas: BudgetProposalRow[];
  total: number;
  onCerrar: () => void;
}) {
  const tr = TRAMOS[tramo];
  const aportes = filas
    .map((f) => ({ f, v: Math.round(tr.linea(f) * 100) / 100 }))
    .filter((x) => Math.abs(x.v) > 0.005)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const suma = Math.round(aportes.reduce((s, x) => s + x.v, 0) * 100) / 100;
  // ⚠️ Si la suma de los aportes no da el total de arriba, lo decimos. Es el
  // único control que tiene quien lee: sin esto, el panel sería una lista
  // bonita que nadie puede contrastar contra nada.
  const cuadra = Math.abs(suma - total) < 0.5;

  return (
    <div className="rounded-lg border border-teal-300 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-teal-200 bg-teal-50 px-3 py-2">
        <span className="text-sm font-bold text-teal-900">
          {tramo === "plan" || tramo === "posterior"
            ? `${tr.etq} ${anio}`
            : tramo === "arrastre" && anio > new Date().getFullYear() + 1
              ? `Pending before ${anio}`
              : tr.etq}
        </span>
        <span className="tabular text-sm font-bold text-teal-900">{usd(total)}</span>
        <span className="text-xs text-teal-700">
          {aportes.length} line{aportes.length === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={onCerrar}
          className="ml-auto rounded px-2 py-0.5 text-xs font-semibold text-teal-800 hover:bg-teal-100"
        >
          ✕ Close
        </button>
      </div>
      <p className="border-b border-slate-100 px-3 py-2 text-xs text-slate-600">
        <b>Where it comes from:</b> {tr.de}
      </p>
      {aportes.length === 0 ? (
        <p className="px-3 py-3 text-xs text-slate-500">
          No line contributes to this tranche — that is why it reads {usd(total)}.
        </p>
      ) : (
        <div className="max-h-[42vh] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-100 text-left text-slate-500">
              <tr>
                <th className="px-3 py-1">WBS</th>
                <th className="px-3 py-1">Task</th>
                <th className="px-3 py-1">Section</th>
                <th className="px-3 py-1 text-right">Amount</th>
                <th className="px-3 py-1 text-right">% of total</th>
              </tr>
            </thead>
            <tbody>
              {aportes.map(({ f, v }) => (
                <tr key={f.wbs_code} className="border-b border-slate-50">
                  <td className="px-3 py-0.5 font-mono text-xs">{f.wbs_code}</td>
                  <td className="px-3 py-0.5">{f.title}</td>
                  <td className="px-3 py-0.5 text-slate-400">{f.category}</td>
                  <td className="tabular px-3 py-0.5 text-right font-semibold">{usd(v)}</td>
                  <td className="tabular px-3 py-0.5 text-right text-slate-400">
                    {total ? `${Math.round((v / total) * 1000) / 10}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 border-t-2 border-slate-700 bg-[#D8F4E6] font-bold">
              <tr>
                <td className="px-3 py-1" colSpan={3}>
                  SUM OF THE {aportes.length} LINE{aportes.length === 1 ? "" : "S"}
                </td>
                <td className="tabular px-3 py-1 text-right">{usd(suma)}</td>
                <td
                  className={`px-3 py-1 text-right text-xs ${
                    cuadra ? "text-emerald-700" : "text-red-700"
                  }`}
                >
                  {cuadra ? "✓ matches" : `≠ by ${usd(Math.round((suma - total) * 100) / 100)}`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── 1 · Datos: lo que la línea tiene y cómo se reparte el remanente ─────── */

function TablaDatos({
  d,
  porCat,
}: {
  d: NonNullable<ReturnType<typeof useBudgetProposal>["data"]>;
  porCat: [string, BudgetProposalRow[]][];
}) {
  const t = d.totales;
  const COLS = [
    ["Budget", "budget_revised", "text-slate-500"],
    ["Spent", "spend", "text-slate-500"],
    ["Remaining", "remaining", "font-semibold"],
    ["Overdue", "vencido", "bg-red-50 font-semibold text-red-700"],
    ["Carry-over", "arrastre", "bg-amber-50 text-amber-800"],
    [`Plan ${d.anio}`, "plan_total", ""],
    [`After ${d.anio}`, "posterior", "text-slate-500"],
    ["PROPOSAL", "propuesta_total", "bg-emerald-50 font-bold text-emerald-900"],
  ] as const;

  return (
    <table className="w-full border-collapse text-xs">
      <thead className="sticky top-0 z-10">
        <tr className="bg-[#005C40] text-white">
          <th className="px-2 py-1 text-left">WBS</th>
          <th className="px-2 py-1 text-left">Task</th>
          {COLS.map(([etq]) => (
            <th key={etq} className="px-2 py-1 text-right">
              {etq}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {porCat.map(([cat, ls]) => {
          const sum = (k: string) => ls.reduce((s, f) => s + (Number(f[k as never]) || 0), 0);
          return (
            <Fragment key={cat}>
              <tr className="bg-[#F0F1EB]">
                <td colSpan={2 + COLS.length} className="px-2 py-1 font-semibold text-teal-900">
                  {cat.toUpperCase()}
                </td>
              </tr>
              {ls.map((f) => {
                const cerrada = f.remaining < 0.5 && f.propuesta_total < 0.5;
                return (
                  <tr
                    key={f.wbs_code}
                    className={`border-b border-slate-100 hover:bg-slate-50 ${
                      cerrada ? "text-slate-400" : ""
                    }`}
                  >
                    <td className="px-2 font-mono text-xs">{f.wbs_code}</td>
                    <td className="px-2">
                      {f.title}
                      {f.ritmo_ledger ? (
                        <span
                          className="ml-1 rounded bg-amber-100 px-1 text-xs font-medium text-amber-800"
                          title={`The LEDGER pays ${usd(f.ritmo_ledger)} a month on this line. Informative: it does not move the budget.`}
                        >
                          ledger {usd(f.ritmo_ledger)}/mo
                        </span>
                      ) : null}
                    </td>
                    {COLS.map(([etq, k, cls]) => (
                      <td key={etq} className={`tabular px-2 text-right ${cls}`}>
                        {usd(Number(f[k as never]))}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr className="bg-[#D8F4E6] font-semibold">
                <td className="px-2" />
                <td className="px-2">Subtotal {cat}</td>
                {COLS.map(([etq, k]) => (
                  <td key={etq} className="tabular px-2 text-right">
                    {usd(sum(k))}
                  </td>
                ))}
              </tr>
            </Fragment>
          );
        })}
        <tr className="bg-[#005C40] font-bold text-white">
          <td className="px-2" />
          <td className="px-2">TOTAL {d.anio}</td>
          {[
            t.budget_revised,
            t.spend,
            t.remanente,
            t.vencido,
            t.arrastre,
            t.plan,
            t.posterior,
            t.propuesta,
          ].map((v, i) => (
            <td key={COLS[i][0]} className="tabular px-2 text-right">
              {usd(v)}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

/* ── 2 · Mes a mes: enero a diciembre, o la semana si hace falta ─────────── */

function TablaMeses({
  d,
  porCat,
  bandas,
  porSemana,
}: {
  d: NonNullable<ReturnType<typeof useBudgetProposal>["data"]>;
  porCat: [string, BudgetProposalRow[]][];
  bandas: { mes: number; desde: number; hasta: number }[];
  porSemana: boolean;
}) {
  const ncols = porSemana ? d.semanas.length : 12;
  const celdas = (f: BudgetProposalRow) =>
    porSemana ? d.semanas.map((w) => Number(f.propuesta[w]) || 0) : porMes(f);
  const suma = (ls: BudgetProposalRow[]) =>
    ls.reduce(
      (acc, f) => celdas(f).map((v, i) => (acc[i] ?? 0) + v),
      Array(ncols).fill(0) as number[],
    );

  return (
    <table className="border-collapse text-xs">
      <thead className="sticky top-0 z-10">
        <tr className="bg-[#005C40] text-white">
          <th className="sticky left-0 z-20 bg-[#005C40] px-2 py-1 text-left">WBS</th>
          <th className="px-2 py-1 text-left">Task</th>
          {porSemana
            ? bandas.map((b) => (
                <th
                  key={`${b.mes}-${b.desde}`}
                  colSpan={b.hasta - b.desde + 1}
                  className="border-l border-white/30 px-1 py-1 text-center text-xs"
                >
                  {MES[b.mes]}
                </th>
              ))
            : MES.map((m) => (
                <th key={m} className="border-l border-white/20 px-2 py-1 text-right">
                  {m}
                </th>
              ))}
          <th className="bg-[#151916] px-2 py-1 text-right">TOTAL</th>
        </tr>
      </thead>
      <tbody>
        {porCat.map(([cat, ls]) => (
          <Fragment key={cat}>
            <tr className="bg-[#F0F1EB]">
              <td colSpan={3 + ncols} className="px-2 py-1 font-semibold text-teal-900">
                {cat.toUpperCase()}
              </td>
            </tr>
            {ls.map((f) => {
              const vs = celdas(f);
              const cerrada = f.remaining < 0.5 && f.propuesta_total < 0.5;
              return (
                <tr
                  key={f.wbs_code}
                  className={`border-b border-slate-100 hover:bg-slate-50 ${
                    cerrada ? "text-slate-400" : ""
                  }`}
                >
                  <td
                    className={`sticky left-0 z-10 px-2 font-mono text-xs ${
                      cerrada ? "bg-slate-50" : "bg-white"
                    }`}
                  >
                    {f.wbs_code}
                  </td>
                  <td className="whitespace-nowrap px-2">{f.title}</td>
                  {vs.map((v, i) => (
                    <td key={i} className={`tabular px-2 text-right ${porSemana ? "text-xs" : ""}`}>
                      {v ? usd(v) : ""}
                    </td>
                  ))}
                  <td className="tabular bg-amber-50 px-2 text-right font-bold">
                    {usd(f.propuesta_total)}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-[#D8F4E6] font-semibold">
              <td className="sticky left-0 z-10 bg-[#D8F4E6] px-2" />
              <td className="whitespace-nowrap px-2">Subtotal {cat}</td>
              {suma(ls).map((v, i) => (
                <td key={i} className="tabular px-2 text-right">
                  {v ? usd(v) : ""}
                </td>
              ))}
              <td className="tabular px-2 text-right">
                {usd(ls.reduce((s, f) => s + f.propuesta_total, 0))}
              </td>
            </tr>
          </Fragment>
        ))}
        <tr className="bg-[#005C40] font-bold text-white">
          <td className="sticky left-0 z-10 bg-[#005C40] px-2" />
          <td className="whitespace-nowrap px-2">TOTAL {d.anio}</td>
          {suma(porCat.flatMap(([, ls]) => ls)).map((v, i) => (
            <td key={i} className="tabular px-2 text-right">
              {v ? usd(v) : ""}
            </td>
          ))}
          <td className="tabular px-2 text-right">{usd(d.totales.propuesta)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/* ── 3 · Budget: cómo va quedando el año, por sección ────────────────────── */

function TablaAnio({
  d,
  porCat,
}: {
  d: NonNullable<ReturnType<typeof useBudgetProposal>["data"]>;
  porCat: [string, BudgetProposalRow[]][];
}) {
  const t = d.totales;
  const filas = porCat.map(([cat, ls]) => ({
    cat,
    n: ls.length,
    meses: ls.reduce(
      (acc, f) => porMes(f).map((v, i) => acc[i] + v),
      Array(12).fill(0) as number[],
    ),
    total: ls.reduce((s, f) => s + f.propuesta_total, 0),
  }));
  const gran = filas.reduce(
    (acc, r) => acc.map((v, i) => v + r.meses[i]),
    Array(12).fill(0) as number[],
  );

  return (
    <table className="w-full border-collapse text-xs">
      <thead className="sticky top-0 z-10">
        <tr className="bg-[#1161AA] text-white">
          <th className="px-2 py-1 text-left">Section</th>
          <th className="px-2 py-1 text-right">Lines</th>
          {MES.map((m) => (
            <th key={m} className="border-l border-white/20 px-2 py-1 text-right">
              {m}
            </th>
          ))}
          <th className="bg-[#151916] px-2 py-1 text-right">TOTAL {d.anio}</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((r) => (
          <tr key={r.cat} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="px-2 py-1 font-semibold text-teal-900">{r.cat.toUpperCase()}</td>
            <td className="tabular px-2 text-right text-slate-400">{r.n}</td>
            {r.meses.map((v, i) => (
              <td key={i} className="tabular px-2 text-right">
                {v ? usd(v) : ""}
              </td>
            ))}
            <td className="tabular bg-amber-50 px-2 text-right font-bold">{usd(r.total)}</td>
          </tr>
        ))}
        <tr className="bg-[#1161AA] font-bold text-white">
          <td className="px-2 py-1">TOTAL {d.anio}</td>
          <td className="tabular px-2 text-right">{filas.reduce((s, r) => s + r.n, 0)}</td>
          {gran.map((v, i) => (
            <td key={i} className="tabular px-2 text-right">
              {v ? usd(v) : ""}
            </td>
          ))}
          <td className="tabular px-2 text-right">{usd(t.propuesta)}</td>
        </tr>
      </tbody>
    </table>
  );
}
