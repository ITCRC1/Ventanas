"use client";

/**
 * Las facturas de UN proveedor: una fila por concepto facturado.
 *
 * Owner, 2026-10-23: *«se pone el detalle de la factura, se repite la factura
 * según el detalle y se pone subtotal»* · *«todas las líneas de las facturas
 * que estén afuera visible»* · *«que se haga en forma cronológica y que cada
 * vez que llega una factura nueva se ponga acá»* · *«que tenga el número de
 * proyecto y nombre del proyecto»*.
 *
 * ## La factura se REPITE, no se agrupa
 *
 * La primera versión juntaba los datos de la factura con `rowSpan` sobre sus
 * líneas. Se ve más limpio y es peor para lo que esta pantalla sirve: copiar
 * una fila, filtrarla, mandarla por correo. Con la celda combinada, la fila de
 * abajo sale sin fecha y sin número de factura — huérfana.
 *
 * Así que cada renglón se basta solo. El ojo distingue dónde empieza una
 * factura nueva por la raya gruesa, no por un hueco en las columnas.
 *
 * ## Qué monto lleva cada línea
 *
 * El NETO, sin impuesto, igual que la columna DEBE del PDF. El impuesto y el
 * total van a nivel de factura, que es donde el proveedor los pone. Sumar los
 * netos de una factura da su subtotal; por eso la fila del encabezado los
 * repite y no hay que confiar en la suma visual.
 */

import type { IssuerInvoices, IssuerReceipt } from "@/lib/hooks";
import { useInvoicesByIssuer } from "@/lib/hooks";

const money = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? ""
    : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const soloFecha = (s: string | null) => (s ? String(s).slice(0, 10) : "");

function Estado({ r }: { r: IssuerReceipt }) {
  const ligada = (r.n_links ?? 0) > 0;
  const tono = ligada
    ? "bg-emerald-100 text-emerald-800"
    : r.status === "ignored"
      ? "bg-slate-200 text-slate-600"
      : "bg-amber-100 text-amber-800";
  return (
    <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs ${tono}`}>
      {ligada ? "pagada" : r.status === "ignored" ? "anulada" : "sin ligar al pago"}
    </span>
  );
}

export function IssuerInvoicesView({ issuer }: { issuer: string }) {
  const q = useInvoicesByIssuer(issuer);
  if (q.isLoading) return <p className="text-sm text-slate-500">Cargando…</p>;
  if (q.isError)
    return <p className="text-sm text-red-600">No se pudo cargar: {(q.error as Error).message}</p>;

  const d: IssuerInvoices | undefined = q.data;
  const recibos = d?.receipts ?? [];
  if (!recibos.length)
    return <p className="text-sm text-slate-500">No hay facturas de este proveedor.</p>;

  const sum = (f: (r: IssuerReceipt) => unknown) =>
    recibos.reduce((a, r) => a + Number(f(r) || 0), 0);
  const nLineas = recibos.reduce((a, r) => a + Math.max(1, r.lineas.length), 0);

  const th = "border-b border-slate-300 px-2 py-2 text-left font-semibold";
  const thN = th + " text-right";
  const td = "border-b border-slate-200 px-2 py-1.5 align-top";
  const tdN = td + " text-right tabular-nums whitespace-nowrap";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span className="text-lg font-semibold">{d?.issuer_name}</span>
        <span className="text-slate-500">cédula {issuer}</span>
        <span className="text-slate-700">
          <strong>{d?.count}</strong> facturas · <strong>{nLineas}</strong> líneas ·{" "}
          <strong>${money(d?.total)}</strong>
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-slate-300 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className={th}>Emitida</th>
              <th className={th}>Factura</th>
              <th className={th}>Oferta</th>
              <th className={th}>Proyecto</th>
              <th className={th}>Detalle de la línea</th>
              <th className={thN}>Monto línea</th>
              <th className={thN}>Subtotal</th>
              <th className={thN}>Impuesto</th>
              <th className={thN}>Total</th>
              <th className={th}>WBS</th>
              <th className={th}>Estado</th>
              <th className={th}>Archivos</th>
            </tr>
          </thead>
          <tbody>
            {recibos.map((r) => {
              const lineas = r.lineas.length
                ? r.lineas
                : [{ n: 1, detalle: "(no se pudo leer el detalle)", monto: "" }];
              return lineas.map((ln, i) => (
                <tr
                  key={`${r.id}-${i}`}
                  className={i === 0 ? "border-t-2 border-slate-400" : "bg-slate-50/40"}
                >
                  {/* Cada renglón se basta solo: ver la nota de arriba. */}
                  <td className={td + " whitespace-nowrap"}>{soloFecha(r.invoice_date)}</td>
                  <td className={td + " whitespace-nowrap font-mono text-xs"}>
                    {r.invoice_no.slice(-8)}
                    {r.doc_type && r.doc_type !== "FE" && (
                      <span className="ml-1 rounded bg-rose-100 px-1 text-rose-700">
                        {r.doc_type}
                      </span>
                    )}
                  </td>
                  <td className={td + " whitespace-nowrap font-mono text-xs"}>{r.oferta ?? ""}</td>
                  <td className={td + " whitespace-nowrap text-xs"}>{r.proyecto ?? ""}</td>
                  <td className={td}>
                    {lineas.length > 1 && (
                      <span className="mr-1 text-slate-400">{ln.n}.</span>
                    )}
                    {ln.detalle}
                  </td>
                  <td className={tdN}>{money(ln.monto)}</td>
                  <td className={tdN}>{i === 0 ? money(r.subtotal) : ""}</td>
                  <td className={tdN}>{i === 0 ? money(r.tax) : ""}</td>
                  <td className={tdN + " font-semibold"}>{i === 0 ? money(r.total) : ""}</td>
                  <td className={td + " whitespace-nowrap text-xs"}>
                    {i === 0 &&
                      (r.links.length ? (
                        r.links.map((lk) => (
                          <div key={lk.sheet_row_id}>
                            <span className="font-mono font-semibold">{lk.cost_code}</span>
                            <div className="text-slate-500">{lk.wbs_title}</div>
                          </div>
                        ))
                      ) : r.wbs_probable ? (
                        // ⚠️ Rotulado como PROBABLE y en gris: sale de que las
                        // facturas ya ligadas de esta misma oferta apuntan todas
                        // al mismo proyecto. Es una pista para amarrarla, no el
                        // proyecto al que se cargó.
                        <div className="text-slate-400">
                          <span className="font-mono">{r.wbs_probable.cost_code}</span>
                          <div>{r.wbs_probable.wbs_title}</div>
                          <div className="italic">probable · por la oferta</div>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      ))}
                  </td>
                  <td className={td}>{i === 0 && <Estado r={r} />}</td>
                  <td className={td}>
                    {i === 0 && (
                      <div className="flex gap-2 whitespace-nowrap">
                        {r.has_pdf_file ? (
                          <a
                            className="text-brand-700 underline"
                            href={`/api/invoice-receipts/${r.id}/file/pdf`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            PDF
                          </a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                        {r.has_xml_file && (
                          <a
                            className="text-slate-500 underline"
                            href={`/api/invoice-receipts/${r.id}/file/xml`}
                          >
                            XML
                          </a>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ));
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-500 bg-slate-100 font-semibold">
              <td className={td} colSpan={6}>
                TOTAL · {recibos.length} facturas · {nLineas} líneas
              </td>
              <td className={tdN}>{money(sum((r) => r.subtotal))}</td>
              <td className={tdN}>{money(sum((r) => r.tax))}</td>
              <td className={tdN}>{money(sum((r) => r.total))}</td>
              <td className={td} colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        El <strong>monto de la línea</strong> es el neto, sin impuesto — igual que la columna DEBE
        del PDF. <strong>Oferta</strong> es el número de contrato del proveedor y{" "}
        <strong>Proyecto</strong> es como él lo llama, que no siempre coincide con el WBS.
        <strong>«Sin ligar al pago»</strong> no quiere decir que la factura esté sin pagar ni que
        el gasto no tenga proyecto: el ledger lo trae en todas sus filas. Quiere decir que nadie
        dijo todavía cuál pago cubre esta factura. El proyecto <em>probable</em> sale de que las
        facturas ya ligadas de la misma oferta apuntan todas al mismo WBS — es una pista para
        amarrarla, no el proyecto al que se cargó.
      </p>
    </div>
  );
}
