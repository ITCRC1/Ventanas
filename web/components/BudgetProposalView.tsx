"use client";

// Propuesta de presupuesto anual, semana por semana — en vivo.
//
// El año es un selector: se cambia a 2028 y la pantalla y el Excel salen de
// 2028. Antes esto era un script que yo corría a mano para un año fijo.
//
// Lo que hay que entender de la tabla, y por eso está escrito en pantalla y no
// solo acá: cada línea dice de dónde sale su número.
//   · Cronograma (hito) — permisos, obras, la cuota de la propiedad. El LEDGER
//     no puede opinar: todavía no empezaron, no tienen un solo pago.
//   · LEDGER (hábito)   — lo que se paga todos los meses. El LEDGER sabe el
//     monto típico y la semana en que cae; el cronograma no.

import { useMemo, useState } from "react";

import { api } from "@/lib/api";
import { type BudgetProposalRow, useBudgetProposal } from "@/lib/hooks";

const MES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SET", "OCT", "NOV", "DIC"];

function usd(n: number): string {
  if (!n) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function BudgetProposalView() {
  const ahora = new Date().getFullYear();
  const [anio, setAnio] = useState(ahora + 1);
  const q = useBudgetProposal(anio);
  const d = q.data;

  // Las semanas agrupadas por mes, para la banda de arriba.
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
      const a = m.get(f.category);
      if (a) a.push(f);
      else m.set(f.category, [f]);
    }
    return [...m.entries()];
  }, [d?.filas]);

  if (q.isLoading) return <p className="text-sm text-slate-500">Calculando la propuesta…</p>;
  if (q.isError || !d)
    return <p className="text-sm text-red-700">No se pudo calcular la propuesta.</p>;

  const t = d.totales;
  const anios = [ahora, ahora + 1, ahora + 2, ahora + 3];

  return (
    <div className="space-y-3">
      {/* Controles y resumen */}
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
                {anios.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-xl font-bold text-teal-900 tabular">{usd(t.propuesta)}</span>
            <span className="text-[11px] text-teal-700">
              propuesta · {t.lineas} líneas, {t.lineas_habito} de hábito ·{" "}
              {usd(t.plan)} es lo que hoy tiene el cronograma
            </span>
          </div>
          <button
            type="button"
            onClick={() => void api.abrir(`/budget-proposal/export.xlsx?anio=${anio}`, true)}
            className="rounded border border-emerald-600 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
            title="La misma propuesta, en Excel, con los totales por fórmula y la hoja que justifica cada número de hábito"
          >
            ⬇ Excel
          </button>
        </div>
        <p className="border-t border-teal-200 bg-white/60 px-3 py-1.5 text-[11px] text-slate-600">
          <b>Cronograma (hito)</b>: permisos, obras y la cuota de la propiedad — el LEDGER no puede
          opinar porque todavía no empezaron.{" "}
          <b className="text-amber-800">LEDGER (hábito)</b>: lo que se paga todos los meses — el
          monto típico y la semana salen del historial real. Esta pantalla no cambia nada en el
          sistema.
        </p>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="border-collapse text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#0F5F59] text-white">
              <th className="sticky left-0 z-20 bg-[#0F5F59] px-2 py-1 text-left">No. Proyecto</th>
              <th className="px-2 py-1 text-left">Tarea</th>
              <th className="px-2 py-1 text-center">Origen</th>
              <th className="px-2 py-1 text-right">Remanente</th>
              <th className="px-2 py-1 text-right">Plan {d.anio}</th>
              <th className="bg-[#8A5A00] px-2 py-1 text-right">Propuesta</th>
              <th className="bg-[#8A5A00] px-2 py-1 text-right">Dif.</th>
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
              const sum = (k: "remaining" | "plan_total" | "propuesta_total") =>
                ls.reduce((s, f) => s + f[k], 0);
              return (
                <>
                  <tr key={cat} className="bg-[#EAF0FA]">
                    <td
                      colSpan={7 + d.semanas.length}
                      className="px-2 py-1 font-semibold text-teal-900"
                    >
                      {cat.toUpperCase()}
                    </td>
                  </tr>
                  {ls.map((f) => {
                    const led = f.origen === "ledger";
                    return (
                      <tr key={f.wbs_code} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="sticky left-0 z-10 bg-white px-2 font-mono text-[10px]">
                          {f.wbs_code}
                        </td>
                        <td className="px-2">{f.title}</td>
                        <td
                          className={`px-2 text-center text-[10px] ${
                            led ? "bg-amber-100 font-semibold text-amber-800" : "text-slate-500"
                          }`}
                        >
                          {led ? "LEDGER" : "Cronograma"}
                        </td>
                        <td className="tabular px-2 text-right">{usd(f.remaining)}</td>
                        <td className="tabular px-2 text-right text-slate-500">
                          {usd(f.plan_total)}
                        </td>
                        <td className="tabular bg-amber-50 px-2 text-right font-semibold">
                          {usd(f.propuesta_total)}
                        </td>
                        <td
                          className={`tabular px-2 text-right ${
                            f.propuesta_total - f.plan_total > 0.5
                              ? "font-semibold text-emerald-700"
                              : f.propuesta_total - f.plan_total < -0.5
                                ? "font-semibold text-red-700"
                                : "text-slate-400"
                          }`}
                        >
                          {usd(f.propuesta_total - f.plan_total)}
                        </td>
                        {d.semanas.map((w) => {
                          const v = f.propuesta[w];
                          return (
                            <td
                              key={w}
                              className={`tabular px-1 text-center text-[10px] ${
                                v && led ? "bg-amber-100" : ""
                              }`}
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
                    <td />
                    <td className="tabular px-2 text-right">{usd(sum("remaining"))}</td>
                    <td className="tabular px-2 text-right">{usd(sum("plan_total"))}</td>
                    <td className="tabular px-2 text-right">{usd(sum("propuesta_total"))}</td>
                    <td className="tabular px-2 text-right">
                      {usd(sum("propuesta_total") - sum("plan_total"))}
                    </td>
                    <td colSpan={d.semanas.length} />
                  </tr>
                </>
              );
            })}
            <tr className="bg-[#0F5F59] font-bold text-white">
              <td className="sticky left-0 z-10 bg-[#0F5F59] px-2" />
              <td className="px-2">TOTAL {d.anio}</td>
              <td />
              <td className="tabular px-2 text-right">{usd(t.remanente)}</td>
              <td className="tabular px-2 text-right">{usd(t.plan)}</td>
              <td className="tabular px-2 text-right">{usd(t.propuesta)}</td>
              <td className="tabular px-2 text-right">{usd(t.propuesta - t.plan)}</td>
              <td colSpan={d.semanas.length} />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
