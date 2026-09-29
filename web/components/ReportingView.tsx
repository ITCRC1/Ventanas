"use client";

import { PrintBar } from "@/components/PrintBar";
import { num } from "@/lib/format";
import { type ReportColumn, type ReportMeta, useReport, useReportCatalog } from "@/lib/hooks";
import { useMemo, useState } from "react";

// Formato de los reportes: van afuera, así que los montos llevan símbolo y dos
// decimales, y el cero se escribe como "—" para que la tabla respire.
const usd2 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const int0 = new Intl.NumberFormat("en-US");

function celda(v: unknown, kind: ReportColumn["kind"]): string {
  if (v === null || v === undefined || v === "") return "—";
  if (kind === "money") {
    const n = num(v as string);
    if (n === 0) return "—";
    return n < 0 ? `($${usd2.format(Math.abs(n))})` : `$${usd2.format(n)}`;
  }
  if (kind === "int") return int0.format(num(v as string));
  if (kind === "pct") return `${usd2.format(num(v as string))}%`;
  if (kind === "date") return String(v).slice(0, 10);
  return String(v);
}

const alineaDerecha = (k: ReportColumn["kind"]) => k === "money" || k === "int" || k === "pct";

function Tabla({ meta, filas }: { meta: ReportMeta; filas: Record<string, unknown>[] }) {
  // Totales de las columnas de dinero: el mismo criterio que el Excel.
  const totales = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of meta.columns) {
      if (c.kind !== "money") continue;
      t[c.key] = filas.reduce((s, f) => s + num(f[c.key] as string), 0);
    }
    return t;
  }, [meta.columns, filas]);

  if (filas.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
        This report is empty — there is nothing to show for the current data.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-[#1F3864] text-left text-white">
            {meta.columns.map((c) => (
              <th
                key={c.key}
                className={`whitespace-nowrap px-2 py-2 text-[10px] font-semibold uppercase ${
                  alineaDerecha(c.kind) ? "text-right" : "text-left"
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filas.map((f, i) => (
            <tr
              // Las vistas no traen una clave estable; el índice sirve porque la
              // tabla es de solo lectura y se re-monta al cambiar de reporte.
              key={`${meta.name}-${i}`}
              className={i % 2 ? "bg-slate-50/60" : undefined}
            >
              {meta.columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-2 py-1.5 ${
                    alineaDerecha(c.kind)
                      ? "tabular whitespace-nowrap text-right"
                      : "text-slate-700"
                  } ${c.kind === "money" && num(f[c.key] as string) < 0 ? "text-red-600" : ""}`}
                >
                  {celda(f[c.key], c.kind)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {Object.keys(totales).length > 0 ? (
          <tfoot>
            <tr className="border-t-2 border-[#1F3864] bg-slate-100 font-semibold">
              {meta.columns.map((c, i) => (
                <td
                  key={c.key}
                  className={`px-2 py-1.5 ${alineaDerecha(c.kind) ? "tabular text-right" : ""}`}
                >
                  {i === 0 ? "TOTAL" : c.kind === "money" ? celda(totales[c.key], "money") : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

export function ReportingView() {
  const catalogo = useReportCatalog();
  const [sel, setSel] = useState<string | null>(null);
  // Sin elección todavía, abre en el primer reporte CON filas: entrar a una
  // tabla vacía hace pensar que la pantalla no cargó. Se deriva en vez de
  // setear estado durante el render.
  const activo = sel ?? catalogo.data?.reports.find((r) => r.rows > 0)?.name ?? null;
  const meta = catalogo.data?.reports.find((r) => r.name === activo) ?? null;
  const datos = useReport(activo);

  const corte = catalogo.data?.cutoff_date;
  const filas = datos.data ?? [];
  const truncado = meta && meta.rows > filas.length;

  return (
    <div className="grid gap-5 lg:grid-cols-[250px_1fr]">
      {/* Índice de reportes */}
      <nav className="space-y-4 print:hidden">
        {catalogo.isPending ? <p className="text-sm text-slate-500">Loading…</p> : null}
        {(catalogo.data?.groups ?? []).map((g) => {
          const items = (catalogo.data?.reports ?? []).filter((r) => r.group === g);
          if (items.length === 0) return null;
          return (
            <div key={g}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {g}
              </p>
              <ul className="space-y-0.5">
                {items.map((r) => (
                  <li key={r.name}>
                    <button
                      type="button"
                      onClick={() => setSel(r.name)}
                      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition ${
                        activo === r.name
                          ? "bg-[#1F3864] font-semibold text-white"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      <span>{r.title}</span>
                      <span
                        className={`shrink-0 tabular text-[10px] ${
                          activo === r.name
                            ? "text-slate-300"
                            : r.rows === 0
                              ? "text-slate-300"
                              : "text-slate-400"
                        }`}
                      >
                        {r.rows}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Reporte */}
      <section>
        {meta ? (
          <>
            <PrintBar
              title={meta.title.toUpperCase()}
              subtitle={corte ? `Cut-off ${corte}` : undefined}
            />
            <div className="mb-3 flex items-end justify-between gap-4 print:hidden">
              <div>
                <h2 className="text-lg font-semibold text-[#1F3864]">{meta.title}</h2>
                <p className="mt-0.5 max-w-3xl text-xs text-slate-500">{meta.blurb}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {meta.rows} {meta.rows === 1 ? "row" : "rows"}
                  {corte ? ` · cut-off ${corte}` : ""}
                </p>
              </div>
              <a
                href={`/api/reports/${meta.name}/export.xlsx`}
                className="shrink-0 rounded border border-emerald-600 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                title="Full report in Excel, with header and totals — no row limit"
              >
                ⬇ Excel
              </a>
            </div>

            {truncado ? (
              <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-900 print:hidden">
                Showing the first {filas.length} of {meta.rows} rows. The Excel download has all of
                them.
              </p>
            ) : null}

            {datos.isPending ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : datos.error ? (
              <p className="text-sm text-red-600">This report could not be loaded.</p>
            ) : (
              <Tabla meta={meta} filas={filas} />
            )}
          </>
        ) : catalogo.isPending ? null : (
          <p className="text-sm text-slate-500">Pick a report from the list.</p>
        )}
      </section>
    </div>
  );
}
