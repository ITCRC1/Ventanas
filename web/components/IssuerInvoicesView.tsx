"use client";

/**
 * Las facturas de UN proveedor, con todas sus líneas a la vista.
 *
 * Owner, 2026-10-23, sobre DEHC: *«este proveedor es importante… pones todo el
 * detalle con su descripción y además pones el link para que se baje el PDF»* ·
 * *«todas las líneas de las facturas que estén afuera visible… subtotal,
 * impuesto y total»*.
 *
 * ⚠️ **Nada se colapsa.** La pregunta que contesta esta pantalla es «qué nos
 * está cobrando», y eso se lee en las LÍNEAS: una factura de DEHC puede traer
 * el cierre de un contrato y el arranque de otro en el mismo documento. Un
 * acordeón obliga a abrir dieciséis veces para ver lo que se vino a ver.
 *
 * Por eso la tabla va por línea y los datos de la factura —fecha, número,
 * subtotal, impuesto, total— se agrupan con `rowSpan` sobre sus líneas: el
 * detalle se lee de corrido y los totales no se repiten en cada renglón, que
 * es lo que haría parecer que la factura se cobró varias veces.
 */

import type { IssuerInvoices, IssuerReceipt } from "@/lib/hooks";
import { useInvoicesByIssuer } from "@/lib/hooks";

const money = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? ""
    : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** La fecha sola, sin la hora: en una lista de facturas la hora es ruido. */
const soloFecha = (s: string | null) => (s ? String(s).slice(0, 10) : "");

/** El color del estado. `ignored` es una factura anulada, no un problema. */
function Estado({ r }: { r: IssuerReceipt }) {
  const ligada = (r.n_links ?? 0) > 0;
  const tono = ligada
    ? "bg-emerald-100 text-emerald-800"
    : r.status === "ignored"
      ? "bg-slate-200 text-slate-600"
      : "bg-amber-100 text-amber-800";
  return (
    <span className={`inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs ${tono}`}>
      {ligada ? "pagada · ligada" : r.status === "ignored" ? "anulada" : "sin ligar"}
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

  const th = "border-b border-slate-300 px-3 py-2 text-left font-semibold";
  const thN = th + " text-right";
  const td = "border-b border-slate-200 px-3 py-2 align-top";
  const tdN = td + " text-right tabular-nums whitespace-nowrap";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span className="text-lg font-semibold">{d?.issuer_name}</span>
        <span className="text-slate-500">cédula {issuer}</span>
        <span className="text-slate-700">
          <strong>{d?.count}</strong> facturas · <strong>${money(d?.total)}</strong>
        </span>
      </div>

      <div className="overflow-x-auto rounded border border-slate-300 bg-white">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className={th}>Emitida</th>
              <th className={th}>Factura</th>
              <th className={th}>Detalle de la línea</th>
              <th className={thN}>Monto línea</th>
              <th className={thN}>Subtotal</th>
              <th className={thN}>Impuesto</th>
              <th className={thN}>Total</th>
              <th className={th}>Proyecto</th>
              <th className={th}>Estado</th>
              <th className={th}>Archivos</th>
            </tr>
          </thead>
          <tbody>
            {recibos.map((r) => {
              // Una factura sin líneas en el XML igual tiene que aparecer: que
              // no se pueda leer el detalle es justamente lo que hay que ver.
              const lineas = r.lineas.length
                ? r.lineas
                : [{ detalle: "(el XML no trae detalle de línea)", monto: "", cantidad: "", unidad: "" }];
              const n = lineas.length;
              return lineas.map((ln, i) => (
                <tr key={`${r.id}-${i}`} className={i === 0 ? "border-t-2 border-slate-300" : ""}>
                  {i === 0 && (
                    <>
                      <td className={td + " whitespace-nowrap"} rowSpan={n}>
                        {soloFecha(r.invoice_date)}
                      </td>
                      <td className={td + " font-mono text-xs"} rowSpan={n}>
                        {r.invoice_no}
                        {r.doc_type && r.doc_type !== "FE" && (
                          <span className="ml-1 rounded bg-rose-100 px-1 text-rose-700">
                            {r.doc_type}
                          </span>
                        )}
                      </td>
                    </>
                  )}
                  <td className={td}>{ln.detalle}</td>
                  <td className={tdN}>{money(ln.monto)}</td>
                  {i === 0 && (
                    <>
                      <td className={tdN} rowSpan={n}>{money(r.subtotal)}</td>
                      <td className={tdN} rowSpan={n}>{money(r.tax)}</td>
                      <td className={tdN + " font-semibold"} rowSpan={n}>{money(r.total)}</td>
                      <td className={td} rowSpan={n}>
                        {/* El proyecto lo define el PAGO, no la factura: sin liga
                            no hay proyecto, y eso es lo que hay que ver. */}
                        {r.links.length ? (
                          r.links.map((lk) => (
                            <div key={lk.sheet_row_id} className="whitespace-nowrap">
                              <span className="font-mono text-xs font-semibold">
                                {lk.cost_code}
                              </span>
                              <div className="text-xs text-slate-600">{lk.wbs_title}</div>
                            </div>
                          ))
                        ) : (
                          <span className="text-xs text-slate-400">sin asignar</span>
                        )}
                      </td>
                      <td className={td} rowSpan={n}>
                        <Estado r={r} />
                        {r.links.map((lk) => (
                          <div key={lk.sheet_row_id} className="mt-1 text-xs text-slate-500">
                            {soloFecha(lk.entry_date)} · WBS {lk.cost_code} · $
                            {money(lk.amount_paid)}
                          </div>
                        ))}
                      </td>
                      <td className={td} rowSpan={n}>
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
                            <span className="text-slate-400">sin PDF</span>
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
                      </td>
                    </>
                  )}
                </tr>
              ));
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-400 bg-slate-50 font-semibold">
              <td className={td} colSpan={4}>
                TOTAL · {recibos.length} facturas
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
        El detalle sale del XML de Hacienda, que es el documento legal. El PDF es su
        representación gráfica. «Sin ligar» significa que el sistema no tiene amarrado el pago —
        no que la factura esté sin pagar.
      </p>
    </div>
  );
}
