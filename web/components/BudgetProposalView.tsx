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

import { useMemo, useState } from "react";

import { api } from "@/lib/api";
import { type BudgetProposalRow, useBudgetProposal } from "@/lib/hooks";

const MES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SET", "OCT", "NOV", "DIC"];

function usd(n: number | null | undefined): string {
  if (!n) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function BudgetProposalView() {
  const ahora = new Date().getFullYear();
  const [anio, setAnio] = useState(ahora + 1);
  const [soloConMonto, setSoloConMonto] = useState(false);
  const q = useBudgetProposal(anio);
  const d = q.data;

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

  if (q.isLoading) return <p className="text-sm text-slate-500">Calculando el presupuesto…</p>;
  if (q.isError || !d)
    return <p className="text-sm text-red-700">No se pudo calcular el presupuesto.</p>;

  const t = d.totales;
  const mostradas = porCat.reduce((s, [, ls]) => s + ls.length, 0);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-teal-200 bg-teal-50/60">
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-teal-900">
              Año
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
              propuesta {anio} · {mostradas} de {t.lineas} líneas del Job Cost
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-teal-800">
              <input
                type="checkbox"
                checked={soloConMonto}
                onChange={(e) => setSoloConMonto(e.target.checked)}
              />
              Esconder las líneas cerradas
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
            ["Remanente del Job Cost", t.remanente, "text-slate-900"],
            ["Vencido (semana ya pasó)", t.vencido, "text-red-700"],
            ["Arrastre de este año", t.arrastre, "text-amber-700"],
            [`Plan ${anio}`, t.plan, "text-slate-900"],
            [`Posterior a ${anio}`, t.posterior, "text-slate-500"],
            ["Sin ubicar", t.sin_ubicar, Math.abs(t.sin_ubicar) > 5 ? "text-red-700" : "text-emerald-700"],
          ].map(([et, v, cls]) => (
            <div key={String(et)}>
              <div className="uppercase tracking-wide text-slate-400">{et}</div>
              <div className={`tabular font-bold ${cls}`}>{usd(Number(v))}</div>
            </div>
          ))}
        </div>
        <p className="border-t border-teal-200 px-3 py-1.5 text-[11px] text-slate-600">
          El <b>Job Cost es el estándar</b>: el remanente de cada línea se reparte entre los cuatro
          tramos y tienen que sumarlo — por eso está el control <b>Sin ubicar</b>. La propuesta es{" "}
          <b>vencido + arrastre + plan</b>, y lo que no pasó se coloca en la primera semana del año
          para que se vea y alguien lo mueva a sabiendas. Esta pantalla no cambia nada.
        </p>
      </div>

      <div className="max-h-[68vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="border-collapse text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#0F5F59] text-white">
              <th className="sticky left-0 z-20 bg-[#0F5F59] px-2 py-1 text-left">WBS</th>
              <th className="px-2 py-1 text-left">Tarea</th>
              <th className="px-2 py-1 text-right">Presup.</th>
              <th className="px-2 py-1 text-right">Gastado</th>
              <th className="px-2 py-1 text-right">Remanente</th>
              <th className="bg-[#8C2F2F] px-2 py-1 text-right">Vencido</th>
              <th className="bg-[#8A5A00] px-2 py-1 text-right">Arrastre</th>
              <th className="px-2 py-1 text-right">Plan {d.anio}</th>
              <th className="px-2 py-1 text-right">Posterior</th>
              <th className="bg-[#1A7F4B] px-2 py-1 text-right">PROPUESTA</th>
              {bandas.map((b) => (
                <th
                  key={`${b.mes}-${b.desde}`}
                  colSpan={b.hasta - b.desde + 1}
                  className="border-l border-white/30 px-1 py-1 text-center text-[10px]"
                >
                  {MES[b.mes]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {porCat.map(([cat, ls]) => {
              const sum = (k: keyof BudgetProposalRow) =>
                ls.reduce((s, f) => s + (Number(f[k]) || 0), 0);
              return (
                <>
                  <tr key={cat} className="bg-[#EAF0FA]">
                    <td colSpan={10 + d.semanas.length} className="px-2 py-1 font-semibold text-teal-900">
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
                        <td
                          className={`sticky left-0 z-10 px-2 font-mono text-[10px] ${
                            cerrada ? "bg-slate-50" : "bg-white"
                          }`}
                        >
                          {f.wbs_code}
                        </td>
                        <td className="px-2">
                          {f.title}
                          {f.ritmo_ledger ? (
                            <span
                              className="ml-1 rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-800"
                              title={`El LEDGER paga ${usd(f.ritmo_ledger)} por mes en esta línea. Informativo: no mueve el presupuesto.`}
                            >
                              ledger {usd(f.ritmo_ledger)}/mes
                            </span>
                          ) : null}
                        </td>
                        <td className="tabular px-2 text-right text-slate-500">
                          {usd(f.budget_revised)}
                        </td>
                        <td className="tabular px-2 text-right text-slate-500">{usd(f.spend)}</td>
                        <td className="tabular px-2 text-right font-semibold">
                          {usd(f.remaining)}
                        </td>
                        <td className="tabular bg-red-50 px-2 text-right font-semibold text-red-700">
                          {usd(f.vencido)}
                        </td>
                        <td className="tabular bg-amber-50 px-2 text-right text-amber-800">
                          {usd(f.arrastre)}
                        </td>
                        <td className="tabular px-2 text-right">{usd(f.plan_total)}</td>
                        <td className="tabular px-2 text-right text-slate-500">
                          {usd(f.posterior)}
                        </td>
                        <td className="tabular bg-emerald-50 px-2 text-right font-bold text-emerald-900">
                          {usd(f.propuesta_total)}
                        </td>
                        {d.semanas.map((w) => {
                          const v = f.propuesta[w];
                          return (
                            <td
                              key={w}
                              className="tabular px-1 text-center text-[10px]"
                              title={v ? `${w} · ${usd(v)}` : undefined}
                            >
                              {v ? Math.round(v / 1000) + "K" : ""}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  <tr key={`${cat}-sub`} className="bg-[#DCE6F4] font-semibold">
                    <td className="sticky left-0 z-10 bg-[#DCE6F4] px-2" />
                    <td className="px-2">Subtotal {cat}</td>
                    <td className="tabular px-2 text-right">{usd(sum("budget_revised"))}</td>
                    <td className="tabular px-2 text-right">{usd(sum("spend"))}</td>
                    <td className="tabular px-2 text-right">{usd(sum("remaining"))}</td>
                    <td className="tabular px-2 text-right text-red-700">{usd(sum("vencido"))}</td>
                    <td className="tabular px-2 text-right text-amber-800">
                      {usd(sum("arrastre"))}
                    </td>
                    <td className="tabular px-2 text-right">{usd(sum("plan_total"))}</td>
                    <td className="tabular px-2 text-right">{usd(sum("posterior"))}</td>
                    <td className="tabular px-2 text-right text-emerald-900">
                      {usd(sum("propuesta_total"))}
                    </td>
                    <td colSpan={d.semanas.length} />
                  </tr>
                </>
              );
            })}
            <tr className="bg-[#0F5F59] font-bold text-white">
              <td className="sticky left-0 z-10 bg-[#0F5F59] px-2" />
              <td className="px-2">TOTAL {d.anio}</td>
              <td className="tabular px-2 text-right">{usd(t.budget_revised)}</td>
              <td className="tabular px-2 text-right">{usd(t.spend)}</td>
              <td className="tabular px-2 text-right">{usd(t.remanente)}</td>
              <td className="tabular px-2 text-right">{usd(t.vencido)}</td>
              <td className="tabular px-2 text-right">{usd(t.arrastre)}</td>
              <td className="tabular px-2 text-right">{usd(t.plan)}</td>
              <td className="tabular px-2 text-right">{usd(t.posterior)}</td>
              <td className="tabular px-2 text-right">{usd(t.propuesta)}</td>
              <td colSpan={d.semanas.length} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
