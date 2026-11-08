"use client";

import { compactMoney, isNegative, money, moneyUsd, num, pct } from "@/lib/format";
import { useFinancials, useScheduleCells, useShortPayments } from "@/lib/hooks";
import type { WbsFinancials } from "@/lib/types";
import { type ReactNode, useMemo } from "react";
import { Bar, BarChart, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const STATE_COLOR: Record<string, string> = {
  not_started: "#94a3b8",
  in_process: "#eab308",
  approved: "#1155CC",
  attention: "#B85B22",
  completed: "#38761D",
};
const STATE_LABEL: Record<string, string> = {
  not_started: "Not Started",
  in_process: "In process",
  approved: "Approved",
  attention: "Attention",
  completed: "Completed",
};
interface CatGroup {
  category: string;
  budget: number;
  spend: number;
  remaining: number;
  lines: WbsFinancials[];
}

// Celda de dinero con signo $ y negativos en rojo (pedido del owner).
function money$(v: string | number | null): ReactNode {
  return <span className={isNegative(v) ? "text-red-600" : undefined}>{moneyUsd(v)}</span>;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "2026-11-01" o "2026-11" -> "nov 2026". */
function mesCorto(iso: string): string {
  const [a, m] = (iso || "").split("-");
  const i = Number(m) - 1;
  return MESES[i] ? `${MESES[i]} ${a}` : iso;
}

function Kpi({
  label,
  value,
  sub,
  acento = false,
}: {
  label: string;
  value: string;
  sub?: string;
  acento?: boolean;
}) {
  // Los indicadores de lo que VIENE van con borde azul: se leen distinto de los
  // del proyecto, que miran hacia atras.
  return (
    <div
      className={`rounded-lg border p-4 ${
        acento ? "border-[#1155CC]/40 bg-[#F5F8FF]" : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
      {sub ? <p className="text-xs text-slate-400">{sub}</p> : null}
    </div>
  );
}

// La seccion del WBS: el primer segmento del codigo ("3.1.2" -> "3").
const seccionDe = (code: string): string => (code || "").split(".")[0];

export function DashboardView() {
  const financials = useFinancials();
  const celdas = useScheduleCells();
  const tandas = useShortPayments();

  const { groups, totals, venta, mini, secciones, byState } = useMemo(() => {
    const todas = financials.data ?? [];
    const rows = todas.filter((r) => r.kind !== "section_header");
    const map = new Map<string, CatGroup>();
    const states = new Map<string, number>();
    for (const r of rows) {
      const cat = r.category ?? "Uncategorized";
      const g = map.get(cat) ?? { category: cat, budget: 0, spend: 0, remaining: 0, lines: [] };
      g.budget += num(r.budget_revised);
      g.spend += num(r.spend);
      g.remaining += num(r.remaining);
      g.lines.push(r);
      map.set(cat, g);
      states.set(r.state, (states.get(r.state) ?? 0) + 1);
    }
    const groups = [...map.values()].sort((a, b) => b.budget - a.budget);

    // ⚠️ Los totales NO llevan la venta del lote. Pedido del owner, 2026-11-08:
    // «hacer el Job Cost resumido Total, sin meter venta de lote». Ademas deja
    // esta pantalla de acuerdo con el Job Cost y el Timeline, que ya filtran
    // kind='proceeds': antes el Dashboard decia $20,560,443 de presupuesto y
    // el Job Cost $21,040,443 — la misma app contra si misma por $480,000.
    const sumar = (ls: WbsFinancials[]) =>
      ls.reduce(
        (a, r) => ({
          budget: a.budget + num(r.budget_revised),
          spend: a.spend + num(r.spend),
          remaining: a.remaining + num(r.remaining),
        }),
        { budget: 0, spend: 0, remaining: 0 },
      );
    const gastos = rows.filter((r) => r.kind !== "proceeds");
    const totals = sumar(gastos);
    const venta = sumar(rows.filter((r) => r.kind === "proceeds"));

    // Mini proyectos = todo menos la seccion 0 (la compra del terreno y su
    // sostenimiento: impuestos, intereses, legal, overhead). Es el trabajo
    // propiamente dicho — planos, permisos, agua, concesiones, construccion.
    const mini = { ...sumar(gastos.filter((r) => seccionDe(r.wbs_code) !== "0")), lineas: 0 };
    mini.lineas = gastos.filter((r) => seccionDe(r.wbs_code) !== "0").length;

    // Job Cost resumido: una fila por seccion del WBS, que es como agrupa el
    // Job Cost de verdad (no por categoria, que cruza secciones).
    const titulos = new Map(
      todas.filter((r) => /^\d+$/.test(r.wbs_code)).map((r) => [r.wbs_code, r.title]),
    );
    const porSec = new Map<string, { budget: number; spend: number; remaining: number; n: number }>();
    for (const r of gastos) {
      const k = seccionDe(r.wbs_code);
      const a = porSec.get(k) ?? { budget: 0, spend: 0, remaining: 0, n: 0 };
      a.budget += num(r.budget_revised);
      a.spend += num(r.spend);
      a.remaining += num(r.remaining);
      a.n += 1;
      porSec.set(k, a);
    }
    const secciones = [...porSec.entries()]
      .map(([code, v]) => ({ code, title: titulos.get(code) ?? "—", ...v }))
      .sort((a, b) => (Number(a.code) || 0) - (Number(b.code) || 0));

    const byState = [...states.entries()].map(([code, count]) => ({
      code,
      label: STATE_LABEL[code] ?? code,
      count,
    }));
    return { groups, totals, venta, mini, secciones, byState };
  }, [financials.data]);

  // ── Indicadores lideres: lo que viene, no lo que ya paso ────────────────
  const adelanto = useMemo(() => {
    const hoy = new Date();
    const mes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const mesAct = mes(hoy);
    const mesSig = mes(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1));
    const anio = String(hoy.getFullYear());
    const hoyIso = hoy.toISOString().slice(0, 10);

    let actual = 0;
    let siguiente = 0;
    let anioHecho = 0;
    let anioFalta = 0;
    for (const c of celdas.data ?? []) {
      const m = (c.week_start || "").slice(0, 7);
      const v = num(c.planned_amount);
      if (m === mesAct) actual += v;
      if (m === mesSig) siguiente += v;
      if ((c.week_start || "").slice(0, 4) === anio) {
        if (c.week_start < hoyIso) anioHecho += v;
        else anioFalta += v;
      }
    }

    // "Recien pedido": la ultima tanda de Short Payment por periodo.
    const bs = [...(tandas.data ?? [])].sort((a, b) =>
      a.period_month === b.period_month
        ? b.disb_no - a.disb_no || b.disb_sub - a.disb_sub
        : a.period_month < b.period_month
          ? 1
          : -1,
    );
    const ultima = bs[0] ?? null;
    // Lo pedido y todavia no pagado: toda tanda que no esta cerrada.
    const pendiente = (tandas.data ?? [])
      .filter((b) => b.status !== "paid")
      .reduce((s, b) => s + num(b.total_amount), 0);

    return { actual, siguiente, anioHecho, anioFalta, ultima, pendiente, mesAct, mesSig, anio };
  }, [celdas.data, tandas.data]);

  if (financials.isLoading) return <p className="text-sm text-slate-500">Loading dashboard…</p>;

  const shortCat = (c: string) => (c.length > 16 ? `${c.slice(0, 15)}…` : c);
  const budgetVsSpend = groups.map((g) => ({
    name: shortCat(g.category),
    Budget: Math.round(g.budget),
    Spend: Math.round(g.spend),
  }));
  const executed = groups
    .map((g) => ({ name: shortCat(g.category), pct: g.budget ? (g.spend / g.budget) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct);

  return (
    <div className="space-y-5">
      {/* ── Indicadores lideres: plata que todavia no salio ───────────── */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Lo que viene
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi
            label="Recien pedido"
            value={adelanto.ultima ? moneyUsd(adelanto.ultima.total_amount) : "-"}
            sub={
              adelanto.ultima
                ? `Tanda #${adelanto.ultima.disb_no}.${adelanto.ultima.disb_sub} \u00b7 ${mesCorto(adelanto.ultima.period_month)}`
                : "sin tandas"
            }
            acento
          />
          <Kpi
            label="Pedido sin pagar"
            value={moneyUsd(adelanto.pendiente)}
            sub={`${(tandas.data ?? []).filter((b) => b.status !== "paid").length} tandas abiertas`}
            acento
          />
          <Kpi
            label={`Este mes \u00b7 ${mesCorto(adelanto.mesAct)}`}
            value={moneyUsd(adelanto.actual)}
            acento
          />
          <Kpi
            label={`Mes siguiente \u00b7 ${mesCorto(adelanto.mesSig)}`}
            value={moneyUsd(adelanto.siguiente)}
            acento
          />
          <Kpi
            label={`Falta en ${adelanto.anio}`}
            value={moneyUsd(adelanto.anioFalta)}
            sub={`${moneyUsd(adelanto.anioHecho)} ya ejecutado \u00b7 ${moneyUsd(adelanto.anioHecho + adelanto.anioFalta)} el a\u00f1o`}
            acento
          />
        </div>
      </div>

      {/* ── El proyecto. SIN la venta del lote ────────────────────────────── */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          El proyecto{" "}
          <span className="font-normal normal-case text-slate-400">
            &mdash; sin la venta del lote
          </span>
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Presupuesto revisado" value={moneyUsd(totals.budget)} />
          <Kpi
            label="Gastado"
            value={moneyUsd(totals.spend)}
            sub={`${pct(totals.spend, totals.budget)} ejecutado`}
          />
          <Kpi label="Remanente" value={moneyUsd(totals.remaining)} />
          <Kpi
            label="Mini proyectos"
            value={moneyUsd(mini.budget)}
            sub={`${mini.lineas} l\u00edneas \u00b7 ${moneyUsd(mini.remaining)} por gastar`}
          />
          <Kpi
            label="Venta del lote"
            value={moneyUsd(venta.budget)}
            sub="fuera de los totales de arriba"
          />
        </div>
      </div>

      {/* Gráficas */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-slate-600">Budget vs. Spend by Category</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={budgetVsSpend} margin={{ left: 8, right: 8 }}>
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10 }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={60}
              />
              <YAxis tickFormatter={compactMoney} tick={{ fontSize: 10 }} width={48} />
              <Tooltip formatter={(v: number) => money(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Budget" fill="#94a3b8" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Spend" fill="#1155CC" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-slate-600">% Executed by Category</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={executed} layout="vertical" margin={{ left: 8, right: 24 }}>
              {/* Redondear: con una barra negativa el dominio se estira y las
                  marcas salian como "-7.544919930022878%". */}
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(v: number) => `${Math.round(v)}%`}
                tick={{ fontSize: 10 }}
              />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={110} />
              <Tooltip formatter={(v: number) => `${Math.round(v)}%`} />
              <Bar dataKey="pct" radius={[0, 3, 3, 0]}>
                {executed.map((e) => (
                  <Cell key={e.name} fill={e.pct > 100 ? "#dc2626" : "#38761D"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-slate-600">Lines by Status</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byState} margin={{ left: 8, right: 8 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} width={28} />
              <Tooltip />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {byState.map((s) => (
                  <Cell key={s.code} fill={STATE_COLOR[s.code] ?? "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Job Cost resumido: una fila por seccion del WBS, que es como
          agrupa el Job Cost de verdad. La tabla de abajo agrupa por CATEGORIA,
          y las categorias CRUZAN secciones (CFIA Infrastructure = 7 y 9,
          Concessions = 5 y 8), asi que los subtotales de una no se pueden
          cuadrar contra los de la otra. Por eso van las dos. ──────────────── */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-3 py-2">
          <p className="text-sm font-semibold text-slate-600">Job Cost resumido</p>
          <p className="text-xs text-slate-400">
            Por secci&oacute;n del WBS, sin la venta del lote. El total es el del proyecto.
          </p>
        </div>
        <table className="min-w-[560px] text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="whitespace-nowrap px-3 py-2">Secci&oacute;n</th>
              <th className="px-3 py-2 text-right">L&iacute;neas</th>
              <th className="px-3 py-2 text-right">Presupuesto</th>
              <th className="px-3 py-2 text-right">Gastado</th>
              <th className="px-3 py-2 text-right">Remanente</th>
              <th className="px-3 py-2 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {secciones.map((x) => (
              <tr key={x.code} className="border-t border-slate-100">
                <td className="tabular px-3 py-1.5 text-slate-400">{x.code}</td>
                <td className="whitespace-nowrap px-3 py-1.5">{x.title}</td>
                <td className="tabular px-3 py-1.5 text-right text-slate-500">{x.n}</td>
                <td className="tabular px-3 py-1.5 text-right">{money$(x.budget)}</td>
                <td className="tabular px-3 py-1.5 text-right">{money$(x.spend)}</td>
                <td className="tabular px-3 py-1.5 text-right">{money$(x.remaining)}</td>
                <td className="tabular px-3 py-1.5 text-right text-slate-500">
                  {pct(x.spend, x.budget)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-800 bg-[#C8DCF0] font-bold">
            <tr>
              <td className="px-3 py-2" colSpan={2}>
                TOTAL DEL PROYECTO
              </td>
              <td className="tabular px-3 py-2 text-right">
                {secciones.reduce((n, x) => n + x.n, 0)}
              </td>
              <td className="tabular px-3 py-2 text-right">{money$(totals.budget)}</td>
              <td className="tabular px-3 py-2 text-right">{money$(totals.spend)}</td>
              <td className="tabular px-3 py-2 text-right">{money$(totals.remaining)}</td>
              <td className="tabular px-3 py-2 text-right">{pct(totals.spend, totals.budget)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Tabla agrupada por categoría con subtotales. Ancho justo al contenido
          (la primera columna no se estira) — el resto del ancho queda libre. */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-[460px] text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="whitespace-nowrap px-3 py-2">Category / Line</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-right">Budget</th>
              <th className="px-3 py-2 text-right">Spend</th>
              <th className="px-3 py-2 text-right">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <CategoryBlock key={g.category} g={g} />
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-800 bg-[#C8DCF0] font-bold">
            <tr>
              <td className="px-3 py-2" colSpan={2}>
                GRAND TOTAL &mdash; GASTOS{" "}
                <span className="font-normal">(sin la venta del lote)</span>
              </td>
              <td className="tabular px-3 py-2 text-right">{money$(totals.budget)}</td>
              <td className="tabular px-3 py-2 text-right">{money$(totals.spend)}</td>
              <td className="tabular px-3 py-2 text-right">{money$(totals.remaining)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function CategoryBlock({ g }: { g: CatGroup }) {
  return (
    <>
      {/* Separador de proyecto — mismo formato que el Job Cost: encabezado azul en negrita */}
      <tr className="border-t-2 border-slate-400 bg-[#EAF0FA]">
        <td className="px-3 py-1.5 text-[12px] font-bold uppercase text-slate-800" colSpan={5}>
          {g.category}
        </td>
      </tr>
      {/* La línea de venta (proceeds) NO se lista — va solo en TOTAL VENTA. */}
      {g.lines
        .filter((l) => l.kind !== "proceeds")
        .map((l) => (
          <tr key={l.id} className="border-t border-slate-50 text-slate-600">
            <td className="whitespace-nowrap px-3 py-1 pl-6">{l.title}</td>
            <td className="px-3 py-1 text-center">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: STATE_COLOR[l.state] ?? "#94a3b8" }}
                title={STATE_LABEL[l.state] ?? l.state}
              />
            </td>
            <td className="tabular px-3 py-1 text-right">{money$(l.budget_revised)}</td>
            <td className="tabular px-3 py-1 text-right">{money$(l.spend)}</td>
            <td className="tabular px-3 py-1 text-right">{money$(l.remaining)}</td>
          </tr>
        ))}
      {/* Fila(s) TOTAL del proyecto — mismo formato que el Job Cost. Si hay venta
          (líneas 'proceeds'), se separa en TOTAL GASTOS + TOTAL VENTA (nº de proyecto). */}
      {(() => {
        const sales = g.lines.filter((l) => l.kind === "proceeds");
        if (sales.length === 0) return <DashTotalRow label="TOTAL" v={sub(g.lines)} />;
        const costs = g.lines.filter((l) => l.kind !== "proceeds");
        const code = sales.map((l) => l.wbs_code).join(", ");
        return (
          <>
            <DashTotalRow label="TOTAL EXPENSES" v={sub(costs)} />
            <DashTotalRow label={`TOTAL SALES · ${code}`} v={sub(sales)} venta />
          </>
        );
      })()}
    </>
  );
}

// Suma presupuesto/gasto/remanente de un subconjunto de líneas.
function sub(lines: WbsFinancials[]): { budget: number; spend: number; remaining: number } {
  return {
    budget: lines.reduce((s, l) => s + num(l.budget_revised), 0),
    spend: lines.reduce((s, l) => s + num(l.spend), 0),
    remaining: lines.reduce((s, l) => s + num(l.remaining), 0),
  };
}

function DashTotalRow({
  label,
  v,
  venta = false,
}: {
  label: string;
  v: { budget: number; spend: number; remaining: number };
  venta?: boolean;
}) {
  // La VENTA se aísla en verde con borde propio para diferenciarla de los gastos.
  const cls = venta
    ? "border-y-2 border-emerald-600 bg-[#DFF3E3]"
    : "border-y-2 border-slate-500 bg-[#DCE6F4]";
  return (
    <tr className={`${cls} text-[12px] font-bold`}>
      <td className="px-3 py-1.5 text-right" colSpan={2}>
        {label}
      </td>
      <td className="tabular px-3 py-1.5 text-right">{money$(v.budget)}</td>
      <td className="tabular px-3 py-1.5 text-right">{money$(v.spend)}</td>
      <td className="tabular px-3 py-1.5 text-right">{money$(v.remaining)}</td>
    </tr>
  );
}
