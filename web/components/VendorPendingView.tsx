"use client";

/**
 * Lo que falta por gastar y en qué semanas lo espera el cronograma.
 *
 * Owner, 2026-10-23: *«otro tab para lo pendiente… meter en qué fecha aparecen
 * en el schedule los pendientes, como un mini job cost»*.
 *
 * ## Las dos cifras que no son la misma
 *
 * **Pendiente** es presupuesto menos gastado: lo que queda por desembolsar.
 * **Pintado** es lo que el cronograma tiene puesto en semanas futuras. Que no
 * coincidan no es un error — es la pregunta: si hay $81.948 pendientes en el
 * diseño esquemático y el cronograma sólo tiene $20.000 repartidos, faltan
 * $61.948 sin fecha. Eso es lo que esta pantalla sirve para ver.
 *
 * ⚠️ Sólo cuentan las semanas **posteriores al corte**. Las anteriores son
 * historia: reproducen lo que el LEDGER ya pagó, y sumarlas acá contaría dos
 * veces el gasto que la columna «Gastado» ya trae.
 */

import type { OwnerLine, OwnerWbs } from "@/lib/hooks";
import { useWbsByOwner } from "@/lib/hooks";

const money = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? "—"
    : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const num = (v: unknown) => Number(v ?? 0);

/** `2026-12-07` -> `dic 2026`. El mes basta: la semana exacta se ve al lado. */
const mesDe = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("es-CR", { month: "short", year: "numeric" });
};

export function VendorPendingView({ owner }: { owner: string }) {
  const q = useWbsByOwner(owner);
  if (q.isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (q.isError)
    return <p className="text-sm text-red-600">No se pudo cargar: {(q.error as Error).message}</p>;

  const d: OwnerWbs | undefined = q.data;
  const corte = d?.cutoff_date ?? "";
  const conPendiente = (d?.lines ?? []).filter((l) => num(l.remaining) > 0.005);

  if (!conPendiente.length)
    return (
      <p className="text-sm text-slate-500">
        No queda presupuesto pendiente en las líneas a cargo de {owner}.
      </p>
    );

  /** Las semanas del cronograma POSTERIORES al corte. Ver la nota de arriba. */
  const futuro = (l: OwnerLine) =>
    (d?.schedule[l.wbs_code] ?? []).filter((s) => !corte || s.week_start >= corte);

  const totPend = conPendiente.reduce((a, l) => a + num(l.remaining), 0);
  const totPint = conPendiente.reduce(
    (a, l) => a + futuro(l).reduce((b, s) => b + num(s.planned_amount), 0),
    0,
  );

  const th = "border-b border-slate-300 px-2 py-2 text-left font-semibold";
  const thN = th + " text-right";
  const td = "border-b border-slate-200 px-2 py-1.5";
  const tdN = td + " text-right tabular-nums whitespace-nowrap";

  return (
    <div className="space-y-5">
      <div className="rounded border border-slate-300 bg-white p-3 text-sm">
        <span className="text-slate-600">Corte del cronograma: </span>
        <strong>{corte || "—"}</strong>
        <span className="mx-3 text-slate-300">|</span>
        <span className="text-slate-600">Pendiente: </span>
        <strong>${money(totPend)}</strong>
        <span className="mx-3 text-slate-300">|</span>
        <span className="text-slate-600">Con fecha en el cronograma: </span>
        <strong>${money(totPint)}</strong>
        {Math.abs(totPend - totPint) > 0.5 && (
          <span className="ml-3 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            ${money(totPend - totPint)} sin fecha
          </span>
        )}
      </div>

      {conPendiente.map((l) => {
        const semanas = futuro(l);
        const pintado = semanas.reduce((a, s) => a + num(s.planned_amount), 0);
        const sinFecha = num(l.remaining) - pintado;
        return (
          <div key={l.wbs_code} className="rounded border border-slate-300 bg-white">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-sm">
                <span className="font-mono font-semibold">{l.wbs_code}</span>{" "}
                <span className="text-slate-700">{l.title}</span>
              </span>
              <span className="text-xs text-slate-600">
                presupuesto ${money(l.budget_revised)} · gastado ${money(l.spend)} ·{" "}
                <strong className="text-amber-700">pendiente ${money(l.remaining)}</strong>
              </span>
            </div>

            {semanas.length === 0 ? (
              <p className="px-3 py-2 text-xs text-amber-800">
                El cronograma no tiene ni una semana con monto después del corte: los $
                {money(l.remaining)} pendientes no tienen fecha.
              </p>
            ) : (
              <>
                <table className="w-full border-collapse text-sm">
                  <thead className="text-slate-600">
                    <tr>
                      <th className={th + " w-32"}>Semana</th>
                      <th className={th + " w-28"}>Mes</th>
                      <th className={th}>Estado</th>
                      <th className={thN + " w-36"}>Monto previsto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {semanas.map((s) => (
                      <tr key={s.week_start}>
                        <td className={td + " whitespace-nowrap font-mono text-xs"}>
                          {s.week_start}
                        </td>
                        <td className={td + " text-xs text-slate-500"}>{mesDe(s.week_start)}</td>
                        <td className={td + " text-xs text-slate-500"}>{s.state ?? "—"}</td>
                        <td className={tdN}>{money(s.planned_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 font-semibold">
                      <td className={td} colSpan={3}>
                        Con fecha en el cronograma
                      </td>
                      <td className={tdN}>{money(pintado)}</td>
                    </tr>
                  </tfoot>
                </table>
                {Math.abs(sinFecha) > 0.5 && (
                  <p className="border-t border-slate-200 px-3 py-2 text-xs text-amber-800">
                    Quedan <strong>${money(sinFecha)}</strong> pendientes que el cronograma no
                    tiene repartidos en ninguna semana.
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}

      <p className="text-xs text-slate-500">
        <strong>Pendiente</strong> es presupuesto menos gastado. <strong>Con fecha</strong> es lo
        que el cronograma tiene puesto en semanas posteriores al corte ({corte || "—"}). Las
        semanas anteriores no se cuentan: son historia y reproducen lo que el LEDGER ya pagó, así
        que sumarlas contaría dos veces el mismo gasto.
      </p>
    </div>
  );
}
