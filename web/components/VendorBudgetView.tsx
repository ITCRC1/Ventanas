"use client";

/**
 * El presupuesto que un proveedor tiene a cargo, y en qué se ha gastado.
 *
 * Owner, 2026-10-23, al ver a DEHC en la columna Owner del Timeline Detail:
 * *«necesito sub tabs… 2 para el presupuesto, que acabas de hacer de DEHC, y
 * seguro más abajo se debe poner las tablas de gastos de cada proyecto»*.
 *
 * ## Qué pregunta contesta, que las facturas no
 *
 * La pestaña de facturas dice qué nos cobran. Ésta dice **qué le encargamos**:
 * el `owner` de la línea del WBS es quien responde por la tarea. DEHC aparece
 * en doce líneas por $413.944,70, y la mitad no tiene una sola factura todavía
 * — eso no se ve mirando facturas, porque lo que falta justamente no llegó.
 *
 * ⚠️ `owner` es texto escrito a mano, no una llave contra el beneficiario del
 * pago. Sirve para saber a quién reclamarle, no para cuadrar plata.
 */

import type { OwnerLine, OwnerWbs } from "@/lib/hooks";
import { useWbsByOwner } from "@/lib/hooks";

const money = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? "—"
    : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const num = (v: unknown) => Number(v ?? 0);

export function VendorBudgetView({ owner }: { owner: string }) {
  const q = useWbsByOwner(owner);
  if (q.isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (q.isError)
    return <p className="text-sm text-red-600">No se pudo cargar: {(q.error as Error).message}</p>;

  const d: OwnerWbs | undefined = q.data;
  const lineas = d?.lines ?? [];
  if (!lineas.length)
    return (
      <p className="text-sm text-slate-500">
        Ninguna línea del WBS tiene a «{owner}» como responsable.
      </p>
    );

  const tot = (f: (l: OwnerLine) => unknown) => lineas.reduce((a, l) => a + num(f(l)), 0);

  const th = "border-b border-slate-300 px-2 py-2 text-left font-semibold";
  const thN = th + " text-right";
  const td = "border-b border-slate-200 px-2 py-1.5";
  const tdN = td + " text-right tabular-nums whitespace-nowrap";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-base font-semibold">
          Las {lineas.length} líneas que {owner} tiene a cargo
        </h2>
        <div className="overflow-x-auto rounded border border-slate-300 bg-white">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className={th}>WBS</th>
                <th className={th}>Título</th>
                <th className={th}>Categoría · Fase</th>
                <th className={thN}>Presupuesto</th>
                <th className={thN}>Gastado</th>
                <th className={thN}>Pendiente</th>
                <th className={th}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.wbs_code}>
                  <td className={td + " whitespace-nowrap font-mono text-xs font-semibold"}>
                    {l.wbs_code}
                  </td>
                  <td className={td}>{l.title}</td>
                  <td className={td + " text-xs text-slate-500"}>
                    {[l.category, l.phase].filter(Boolean).join(" · ")}
                  </td>
                  <td className={tdN}>{money(l.budget_revised)}</td>
                  <td className={tdN}>{money(l.spend)}</td>
                  <td
                    className={
                      tdN + (num(l.remaining) > 0.005 ? " font-semibold text-amber-700" : "")
                    }
                  >
                    {money(l.remaining)}
                  </td>
                  <td className={td + " text-xs text-slate-500"}>{l.state}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-400 bg-slate-100 font-semibold">
                <td className={td} colSpan={3}>
                  TOTAL
                </td>
                <td className={tdN}>{money(tot((l) => l.budget_revised))}</td>
                <td className={tdN}>{money(tot((l) => l.spend))}</td>
                <td className={tdN}>{money(tot((l) => l.remaining))}</td>
                <td className={td} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* ── El gasto de cada línea, una tabla por proyecto ────────────────
          Owner: «más abajo se debe poner las tablas de gastos de cada
          proyecto». Una sola tabla con las 100+ filas revueltas no deja ver
          contra qué línea corre cada pago, que es la pregunta. */}
      <div>
        <h2 className="mb-2 text-base font-semibold">El gasto, línea por línea</h2>
        <div className="space-y-4">
          {lineas.map((l) => {
            const pagos = d?.payments[l.wbs_code] ?? [];
            const sumaPagos = pagos.reduce((a, p) => a + num(p.amount_paid), 0);
            return (
              <div key={l.wbs_code} className="rounded border border-slate-300 bg-white">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="text-sm">
                    <span className="font-mono font-semibold">{l.wbs_code}</span>{" "}
                    <span className="text-slate-700">{l.title}</span>
                  </span>
                  <span className="text-xs text-slate-600">
                    {pagos.length} pago{pagos.length === 1 ? "" : "s"} · ${money(sumaPagos)} de $
                    {money(l.budget_revised)}
                  </span>
                </div>
                {pagos.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-slate-500">
                    Sin pagos registrados. El presupuesto está íntegro.
                  </p>
                ) : (
                  <table className="w-full border-collapse text-sm">
                    <thead className="text-slate-600">
                      <tr>
                        <th className={th + " w-28"}>Fecha</th>
                        <th className={th}>Concepto</th>
                        <th className={thN + " w-32"}>Comprometido</th>
                        <th className={thN + " w-32"}>Pagado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagos.map((p) => (
                        <tr key={p.id}>
                          <td className={td + " whitespace-nowrap text-xs"}>
                            {p.entry_date ?? (
                              <span className="text-amber-700">sin fecha</span>
                            )}
                          </td>
                          <td className={td + " text-xs"}>
                            {p.description || p.payee || "—"}
                          </td>
                          <td className={tdN}>{money(p.amount)}</td>
                          <td className={tdN}>{money(p.amount_paid)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Estas líneas son las que tienen a <strong>{owner}</strong> como responsable en el WBS. Ese
        campo es texto escrito a mano: sirve para saber a quién reclamarle, no para cuadrar plata
        contra el beneficiario del pago.
      </p>
    </div>
  );
}
