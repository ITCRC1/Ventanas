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

function usd(n: number | null | undefined): string {
  if (!n) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
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
            "bg-[#2962FF] ring-[#1E53E5]",
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
      "bg-[#1F4E79] ring-[#163C5E]",
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
            <span className="text-[11px] text-teal-700">
              {anio} proposal · {mostradas} of {t.lineas} Job Cost lines
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-teal-800">
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

        {/* Los cuatro tramos del remanente, y el control de que cierren. */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-teal-200 bg-white/60 px-3 py-2 text-[11px] sm:grid-cols-6">
          {[
            ["Job Cost remaining", t.remanente, "text-slate-900"],
            ["Overdue (week already passed)", t.vencido, "text-red-700"],
            ["Carry-over from this year", t.arrastre, "text-amber-700"],
            [`Plan ${anio}`, t.plan, "text-slate-900"],
            [`After ${anio}`, t.posterior, "text-slate-500"],
            [
              "Unplaced",
              t.sin_ubicar,
              Math.abs(t.sin_ubicar) > 5 ? "text-red-700" : "text-emerald-700",
            ],
          ].map(([et, v, cls]) => (
            <div key={String(et)}>
              <div className="uppercase tracking-wide text-slate-400">{et}</div>
              <div className={`tabular font-bold ${cls}`}>{usd(Number(v))}</div>
            </div>
          ))}
        </div>
        {/* Mientras se edita, este parrafo solo roba alto: explica como se
            arma la PROPUESTA, no como se escribe la grilla —que tiene su propia
            ayuda arriba de la tabla—. */}
        <p
          className={`border-t border-teal-200 px-3 py-1.5 text-[11px] text-slate-600 ${
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
    <table className="w-full border-collapse text-[11px]">
      <thead className="sticky top-0 z-10">
        <tr className="bg-[#0F5F59] text-white">
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
              <tr className="bg-[#EAF0FA]">
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
                    <td className="px-2 font-mono text-[10px]">{f.wbs_code}</td>
                    <td className="px-2">
                      {f.title}
                      {f.ritmo_ledger ? (
                        <span
                          className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-800"
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
              <tr className="bg-[#DCE6F4] font-semibold">
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
        <tr className="bg-[#0F5F59] font-bold text-white">
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
    <table className="border-collapse text-[11px]">
      <thead className="sticky top-0 z-10">
        <tr className="bg-[#0F5F59] text-white">
          <th className="sticky left-0 z-20 bg-[#0F5F59] px-2 py-1 text-left">WBS</th>
          <th className="px-2 py-1 text-left">Task</th>
          {porSemana ? (
            bandas.map((b) => (
              <th
                key={`${b.mes}-${b.desde}`}
                colSpan={b.hasta - b.desde + 1}
                className="border-l border-white/30 px-1 py-1 text-center text-[10px]"
              >
                {MES[b.mes]}
              </th>
            ))
          ) : (
            MES.map((m) => (
              <th key={m} className="border-l border-white/20 px-2 py-1 text-right">
                {m}
              </th>
            ))
          )}
          <th className="bg-[#8A5A00] px-2 py-1 text-right">TOTAL</th>
        </tr>
      </thead>
      <tbody>
        {porCat.map(([cat, ls]) => (
          <Fragment key={cat}>
            <tr className="bg-[#EAF0FA]">
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
                    className={`sticky left-0 z-10 px-2 font-mono text-[10px] ${
                      cerrada ? "bg-slate-50" : "bg-white"
                    }`}
                  >
                    {f.wbs_code}
                  </td>
                  <td className="whitespace-nowrap px-2">{f.title}</td>
                  {vs.map((v, i) => (
                    <td
                      key={i}
                      className={`tabular px-2 text-right ${porSemana ? "text-[10px]" : ""}`}
                    >
                      {v ? usd(v) : ""}
                    </td>
                  ))}
                  <td className="tabular bg-amber-50 px-2 text-right font-bold">
                    {usd(f.propuesta_total)}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-[#DCE6F4] font-semibold">
              <td className="sticky left-0 z-10 bg-[#DCE6F4] px-2" />
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
        <tr className="bg-[#0F5F59] font-bold text-white">
          <td className="sticky left-0 z-10 bg-[#0F5F59] px-2" />
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
    <table className="w-full border-collapse text-[11px]">
      <thead className="sticky top-0 z-10">
        <tr className="bg-[#1F4E79] text-white">
          <th className="px-2 py-1 text-left">Section</th>
          <th className="px-2 py-1 text-right">Lines</th>
          {MES.map((m) => (
            <th key={m} className="border-l border-white/20 px-2 py-1 text-right">
              {m}
            </th>
          ))}
          <th className="bg-[#8A5A00] px-2 py-1 text-right">TOTAL {d.anio}</th>
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
        <tr className="bg-[#1F4E79] font-bold text-white">
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
