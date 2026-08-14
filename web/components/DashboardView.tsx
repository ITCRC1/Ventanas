"use client";

import { compactMoney, isNegative, money, moneyUsd, num, pct } from "@/lib/format";
import { useFinancials } from "@/lib/hooks";
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

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
      {sub ? <p className="text-xs text-slate-400">{sub}</p> : null}
    </div>
  );
}

export function DashboardView() {
  const financials = useFinancials();

  const { groups, totals, byState } = useMemo(() => {
    const rows = (financials.data ?? []).filter((r) => r.kind !== "section_header");
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
    const totals = groups.reduce(
      (a, g) => ({
        budget: a.budget + g.budget,
        spend: a.spend + g.spend,
        remaining: a.remaining + g.remaining,
      }),
      { budget: 0, spend: 0, remaining: 0 },
    );
    const byState = [...states.entries()].map(([code, count]) => ({
      code,
      label: STATE_LABEL[code] ?? code,
      count,
    }));
    return { groups, totals, byState };
  }, [financials.data]);

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
      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Revised Budget" value={moneyUsd(totals.budget)} />
        <Kpi
          label="Spend to Date"
          value={moneyUsd(totals.spend)}
          sub={`${pct(totals.spend, totals.budget)} executed`}
        />
        <Kpi label="Remaining" value={moneyUsd(totals.remaining)} />
        <Kpi
          label="Lines / Categories"
          value={`${groups.reduce((n, g) => n + g.lines.length, 0)} / ${groups.length}`}
        />
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
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
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
                GRAND TOTAL
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
