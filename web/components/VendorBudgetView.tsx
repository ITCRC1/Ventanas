"use client";

/**
 * El presupuesto de un proveedor, en el formato del espejo del ledger.
 *
 * Owner, 2026-10-23: *«en tab presupuesto usemos este formato para mostrar el
 * detalle de las facturas, con este formato bonito. Copia el detalle de ledger,
 * bien detallado por línea de factura»*.
 *
 * Son dos cuadros, uno encima del otro:
 *
 * 1. **`InvoicesApplied` acotado al proveedor** — el mismo espejo del ledger
 *    que ya existe, con presupuesto, gasto YTD, facturas aplicadas y el
 *    diferencial. Se reusa el componente, no su estilo: dos copias del mismo
 *    cuadro se separan en el primer arreglo que alguien haga de un lado.
 *
 * 2. **El detalle del ledger, asiento por asiento** — agrupado por línea del
 *    WBS, con su subtotal. El cuadro de arriba dice cuánto; éste dice de qué.
 */

import { Fragment } from "react";
import { InvoicesApplied } from "@/components/InvoicesApplied";
import type { OwnerPago, OwnerWbs } from "@/lib/hooks";
import { useWbsByOwner } from "@/lib/hooks";

const TH = "px-2 py-1 font-semibold";
const THR = `${TH} text-right`;
const TD = "border border-slate-200 px-2 py-1";
const TDR = `${TD} text-right tabular-nums whitespace-nowrap`;

const money = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? "—"
    : Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });

const num = (v: unknown) => Number(v ?? 0);

export function VendorBudgetView({ owner }: { owner: string }) {
  const q = useWbsByOwner(owner);
  const d: OwnerWbs | undefined = q.data;
  const lineas = d?.lines ?? [];

  const todos: OwnerPago[] = lineas.flatMap((l) => d?.payments[l.wbs_code] ?? []);
  const granCom = todos.reduce((a, p) => a + num(p.amount), 0);
  const granPag = todos.reduce((a, p) => a + num(p.amount_paid), 0);

  return (
    <div className="space-y-6">
      {/* ── 1. El espejo del ledger, sólo las líneas de este proveedor ──── */}
      <InvoicesApplied owner={owner} />

      {/* ── 2. El detalle: cada asiento que compone ese gasto ──────────── */}
      <div>
        <h2 className="mb-2 text-base font-semibold">
          El detalle del ledger, asiento por asiento
        </h2>
        {q.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
        {q.isError && (
          <p className="text-sm text-red-600">
            No se pudo cargar: {(q.error as Error).message}
          </p>
        )}
        {!q.isLoading && !lineas.length && (
          <p className="text-sm text-slate-500">
            Ninguna línea del WBS tiene a «{owner}» como responsable.
          </p>
        )}

        {lineas.length > 0 && (
          <div className="max-h-[74vh] overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[1000px] border-collapse text-[11px]">
              <thead className="sticky top-0 z-10 bg-[#434343] text-left text-white">
                <tr>
                  <th className={TH}>WBS</th>
                  <th className={TH}>Date</th>
                  <th className={TH}>Concept</th>
                  <th className={TH}>Invoice #</th>
                  <th className={THR}>Committed</th>
                  <th className={`${THR} bg-[#8a5a00]`}>Paid</th>
                  <th className={THR}>Due</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => {
                  const pagos = d?.payments[l.wbs_code] ?? [];
                  const sCom = pagos.reduce((a, p) => a + num(p.amount), 0);
                  const sPag = pagos.reduce((a, p) => a + num(p.amount_paid), 0);
                  return (
                    <Fragment key={l.wbs_code}>
                      {/* La banda de la línea, como la de categoría del espejo. */}
                      <tr className="bg-slate-100 font-semibold">
                        <td className={TD + " font-mono"}>{l.wbs_code}</td>
                        <td className={TD} colSpan={3}>
                          {l.title}
                          <span className="ml-2 font-normal text-slate-500">
                            presupuesto {money(l.budget_revised)} · pendiente{" "}
                            {money(l.remaining)}
                          </span>
                        </td>
                        <td className={TDR}>{money(l.budget_revised)}</td>
                        <td className={TDR}>{money(l.spend)}</td>
                        <td className={TDR}>{money(l.remaining)}</td>
                      </tr>

                      {pagos.length === 0 ? (
                        <tr>
                          <td className={TD} />
                          <td className={TD + " italic text-slate-400"} colSpan={6}>
                            Sin asientos en el ledger: el presupuesto está íntegro.
                          </td>
                        </tr>
                      ) : (
                        pagos.map((p) => (
                          <tr key={p.id} className="hover:bg-teal-50/40">
                            <td className={TD} />
                            <td className={TD + " whitespace-nowrap text-slate-500"}>
                              {p.entry_date ?? (
                                <span className="text-amber-700">sin fecha</span>
                              )}
                            </td>
                            <td className={TD}>{p.description || p.payee || "—"}</td>
                            <td className={TD + " font-mono text-slate-500"}>
                              {p.invoice_no || ""}
                            </td>
                            <td className={TDR}>{money(p.amount)}</td>
                            <td className={TDR}>{money(p.amount_paid)}</td>
                            <td className={TDR}>{money(p.amount_due)}</td>
                          </tr>
                        ))
                      )}

                      {pagos.length > 0 && (
                        <tr className="bg-slate-50 font-semibold">
                          <td className={TD} />
                          <td className={TD} colSpan={3}>
                            Subtotal {l.wbs_code} · {pagos.length} asiento
                            {pagos.length === 1 ? "" : "s"}
                          </td>
                          <td className={TDR}>{money(sCom)}</td>
                          <td className={TDR}>{money(sPag)}</td>
                          <td className={TDR} />
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-[#434343] font-semibold text-white">
                  <td className={TD} colSpan={4}>
                    TOTAL {owner} · {todos.length} asientos
                  </td>
                  <td className={TDR}>{money(granCom)}</td>
                  <td className={TDR}>{money(granPag)}</td>
                  <td className={TDR} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        El cuadro de arriba es el espejo del ledger con las facturas aplicadas, acotado a las
        líneas que tienen a <strong>{owner}</strong> como responsable. El de abajo es el detalle
        que lo compone: cada asiento del ledger, agrupado por línea. Ese campo de responsable es
        texto escrito a mano — sirve para saber a quién reclamarle, no para cuadrar plata contra
        el beneficiario del pago.
      </p>
    </div>
  );
}
