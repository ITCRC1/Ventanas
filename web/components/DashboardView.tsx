"use client";

/**
 * El tablero del inversionista.
 *
 * Owner, 2026-11-09: *«NO ME GUSTA EL DASHBOARD. NECESITO QUE HAGAS UNA
 * INVESTIGACIÓN EN LA INDUSTRIA DE DESARROLLO DE PROPIEDADES... CUÁLES SON LOS
 * INDICADORES CLAVES DE UN INVERSOR DE BIENES RAÍCES»* · *«DEBEN HABER LEADS
 * INDICATOR»*.
 *
 * ## Qué estaba mal con el anterior
 *
 * Diez tarjetas, todas **rezagadas**: contaban lo que ya había pasado. Y la que
 * decía «Budget Revised $21,040,443» escondía lo más importante que tiene este
 * proyecto para contar — ese número arrancó en $15,726,007 y creció 33.8%.
 *
 * ## Cómo está armado ahora
 *
 * Cuatro bloques, en el orden en que un inversionista pregunta:
 *
 * 1. **¿En qué termina esto?** El Anticipated Final Cost —el estándar de la
 *    industria— partido en pagado / comprometido / sin comprometer, y medido
 *    contra el presupuesto ORIGINAL, no contra el revisado.
 * 2. **¿Qué me avisa antes?** Los cinco indicadores adelantados, con semáforo.
 * 3. **¿Cómo viene?** La curva S y el avance.
 * 4. **¿Qué falta?** Remanente por sección partido en comprometido y sin
 *    comprometer, los llamados de capital por trimestre, y los permisos.
 *
 * ⚠️ **Acá no se calcula nada.** Todo sale de `/dashboard/summary`. La versión
 * anterior sumaba las líneas en el navegador, y eso garantiza que el día que
 * el backend cambie una fórmula las dos cifras digan cosas distintas.
 *
 * ⚠️ **Lo que a propósito NO está:** Profit on Cost, Yield on Cost e IRR. Son
 * las tres métricas con las que el mercado juzga un desarrollo y necesitan el
 * valor esperado del proyecto (GDV), que el sistema no guarda: hay $21M de
 * costo contra una línea de venta de $480,000 sin realizar. Decisión del owner
 * el 2026-11-09: *«solo el costo, por ahora»*. Poner un margen inventado sería
 * peor que no ponerlo.
 */

import { compactMoney, isNegative, moneyUsd } from "@/lib/format";
import { useDashboard } from "@/lib/hooks";
import type { DashboardSummary } from "@/lib/types";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TEAL = "#0F5F59";
const AZUL = "#2962FF";
const GRIS = "#94a3b8";
const ROJO = "#EF5350";
const AMBAR = "#F59E0B";
const VERDE = "#26A69A";

const STATE_COLOR: Record<string, string> = {
  "Not Started": GRIS,
  "In process": "#eab308",
  Approved: "#1155CC",
  Attention: "#B85B22",
  Completed: "#38761D",
};

function money$(v: string | number | null): ReactNode {
  return <span className={isNegative(v) ? "text-red-600" : undefined}>{moneyUsd(v)}</span>;
}

/** El trimestre como lo lee una persona: "Q1 2027", no "2027-01-01". */
function trimestre(iso: string): string {
  const [a, m] = iso.split("-");
  return `Q${Math.floor((Number(m) - 1) / 3) + 1} ${a}`;
}

/** "2026-11" -> "Nov 26", para el eje de la curva. */
const MES3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function mesCorto(iso: string): string {
  const [a, m] = (iso || "").split("-");
  return MES3[Number(m) - 1] ? `${MES3[Number(m) - 1]} ${a.slice(2)}` : iso;
}

/* ── Las piezas ──────────────────────────────────────────────────────────── */

function Kpi({
  label,
  value,
  sub,
  tono,
  grande,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tono?: "ok" | "warn" | "bad";
  grande?: boolean;
}) {
  const borde =
    tono === "bad"
      ? "border-red-300 bg-red-50"
      : tono === "warn"
        ? "border-amber-300 bg-amber-50"
        : tono === "ok"
          ? "border-emerald-300 bg-emerald-50"
          : "border-slate-200 bg-white";
  const color =
    tono === "bad"
      ? "text-red-800"
      : tono === "warn"
        ? "text-amber-900"
        : tono === "ok"
          ? "text-emerald-900"
          : "text-slate-900";
  return (
    <div className={`rounded-lg border p-3 ${borde}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`tabular font-bold ${grande ? "text-2xl" : "text-xl"} ${color}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div> : null}
    </div>
  );
}

function Titulo({ t, sub }: { t: string; sub?: string }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
      {t}
      {sub ? <span className="ml-2 font-normal normal-case text-slate-400">{sub}</span> : null}
    </p>
  );
}

/* ── 1 · ¿En qué termina esto? ───────────────────────────────────────────── */

function EnQueTermina({ d }: { d: DashboardSummary }) {
  const c = d.costo;
  // El crecimiento del presupuesto es el dato que la pantalla vieja escondía.
  const creció = c.crecimiento_pct > 0;
  return (
    <div>
      <Titulo t="Where this ends up" sub="— the one question an investor asks first" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label="Anticipated final cost"
          value={moneyUsd(c.anticipated_final_cost)}
          sub="paid + committed + still to commit"
          grande
        />
        <Kpi
          label="Against the original budget"
          value={money$(c.variacion_vs_original)}
          sub={`${moneyUsd(c.budget_original)} was approved at the start`}
          tono={creció ? "bad" : undefined}
        />
        <Kpi
          label="Paid to date"
          value={moneyUsd(c.pagado)}
          sub={`${d.avance.pct_por_costo.toFixed(1)}% of the revised budget`}
        />
        <Kpi
          label="Committed, not yet paid"
          value={moneyUsd(c.por_pagar)}
          sub="already under contract — unavoidable"
        />
        <Kpi
          label="Still to commit"
          value={moneyUsd(c.sin_comprometer)}
          sub="no contract behind it yet"
          tono={d.adelantados.exposicion_sin_contrato_pct > 50 ? "bad" : undefined}
        />
      </div>

      {/* La cascada del presupuesto: de dónde salió el número revisado. */}
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-[11px]">
          <tbody>
            {(
              [
                ["Original budget", c.budget_original, ""],
                [
                  "Approved changes",
                  c.budget_change,
                  creció ? `+${c.crecimiento_pct.toFixed(1)}% over the original` : "",
                ],
                ["Revised budget", c.budget_revised, "what the Job Cost shows today"],
                ["Paid", -c.pagado, ""],
                ["Committed, not yet paid", -c.por_pagar, ""],
                ["Still to commit", -c.sin_comprometer, ""],
              ] as [string, number, string][]
            ).map(([et, v, nota], i) => (
              <tr
                key={et}
                className={`border-b border-slate-100 ${i === 2 ? "bg-slate-50 font-semibold" : ""}`}
              >
                <td className="px-3 py-1">{et}</td>
                <td className="tabular px-3 py-1 text-right">{money$(v)}</td>
                <td className="px-3 py-1 text-slate-400">{nota}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-700 bg-[#DCE6F4] font-bold">
              <td className="px-3 py-1">ANTICIPATED FINAL COST</td>
              <td className="tabular px-3 py-1 text-right">{moneyUsd(c.anticipated_final_cost)}</td>
              <td className="px-3 py-1" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── 2 · Lo que avisa antes ──────────────────────────────────────────────── */

function Adelantados({ d }: { d: DashboardSummary }) {
  const a = d.adelantados;
  const ct = a.contingencia;
  // La contingencia consumida contra el avance: si se gastó más reserva que
  // obra, el sobrecosto ya está decidido aunque todavía no aparezca.
  const consumidaPct = ct.presupuesto ? (ct.consumida / ct.presupuesto) * 100 : 0;
  const adelantada = ct.existe && consumidaPct > d.avance.pct_por_costo + 10;

  return (
    <div>
      <Titulo
        t="Early warnings"
        sub="— these move before the cost does; the cards above only report what already happened"
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label="Remaining with no contract"
          value={`${a.exposicion_sin_contrato_pct.toFixed(1)}%`}
          sub={`${moneyUsd(a.exposicion_sin_contrato)} priced but not signed`}
          tono={
            a.exposicion_sin_contrato_pct > 75
              ? "bad"
              : a.exposicion_sin_contrato_pct > 40
                ? "warn"
                : "ok"
          }
        />
        <Kpi
          label="Budget growth"
          value={`+${a.crecimiento_presupuesto_pct.toFixed(1)}%`}
          sub="approved changes over the original"
          tono={
            a.crecimiento_presupuesto_pct > 20
              ? "bad"
              : a.crecimiento_presupuesto_pct > 10
                ? "warn"
                : "ok"
          }
        />
        <Kpi
          label="Contingency"
          value={ct.existe ? moneyUsd(ct.queda) : "none"}
          sub={
            ct.existe
              ? `${consumidaPct.toFixed(0)}% used against ${d.avance.pct_por_costo.toFixed(0)}% of the work`
              : "the project runs with no reserve"
          }
          tono={!ct.existe || adelantada ? "warn" : "ok"}
        />
        <Kpi
          label="Lines flagged Attention"
          value={a.atencion_lineas}
          sub={`${moneyUsd(a.atencion_remanente)} still to spend on them`}
          tono={a.atencion_lineas > 0 ? "warn" : "ok"}
        />
        <Kpi
          label={`Cash vs next ${d.dias_caja} days`}
          value={money$(-a.caja_faltante)}
          sub={`${moneyUsd(a.caja_hoy)} in the bank · ${moneyUsd(a.caja_pide_90)} is scheduled`}
          tono={a.caja_faltante > 0 ? "bad" : "ok"}
        />
      </div>

      {!ct.existe ? (
        <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          ⚠ No line is marked as contingency, so the classic early warning —
          <b> reserve used against work completed</b> — cannot be built. The industry carries 5–10%
          of hard costs on ground-up work. Mark a line as contingency in Job Cost and this card
          starts tracking it; how much to reserve is a money decision, so the system does not pick a
          number on its own.
        </p>
      ) : null}
    </div>
  );
}

/* ── 3 · Cómo viene ──────────────────────────────────────────────────────── */

function Avance({ d }: { d: DashboardSummary }) {
  const curva = d.avance.curva.map((p) => ({
    ...p,
    etq: mesCorto(p.mes),
  }));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
        <p className="mb-1 text-sm font-semibold text-slate-600">
          S-curve — planned vs actual, cumulative
        </p>
        {/* ⚠️ La nota no es decoración. El cronograma anterior al corte del
            Forecast se reconstruyó A PARTIR del LEDGER, así que plan y real
            coinciden por construcción en el pasado: comparar ahí es comparar un
            número contra sí mismo. Lo que esta curva muestra es la FORMA de lo
            que viene. */}
        <p className="mb-2 text-[11px] text-slate-400">
          The planned line before the Forecast cut-off was rebuilt from the LEDGER, so the two agree
          in the past by construction — what this shows is the shape of what is still ahead.
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={curva} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="etq" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => compactMoney(v)} />
            <Tooltip
              formatter={(v: number | string) => moneyUsd(v as number)}
              labelStyle={{ fontSize: 11 }}
              contentStyle={{ fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="plan_acum"
              name="Planned"
              stroke={GRIS}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="real_acum"
              name="Actual"
              stroke={AZUL}
              strokeWidth={2.5}
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="mb-1 text-sm font-semibold text-slate-600">Progress</p>
        <p className="mb-3 text-[11px] text-slate-400">
          By cost is a proxy: money does not move at the same pace as the work.
        </p>
        <div className="mb-3">
          <div className="flex items-baseline justify-between text-[11px] text-slate-500">
            <span>By cost</span>
            <span className="tabular font-bold text-slate-800">
              {d.avance.pct_por_costo.toFixed(1)}%
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded bg-slate-200">
            <div
              className="h-full rounded bg-[#2962FF]"
              style={{ width: `${Math.min(d.avance.pct_por_costo, 100)}%` }}
            />
          </div>
        </div>
        <table className="w-full text-[11px]">
          <thead className="text-left text-slate-400">
            <tr>
              <th className="py-1">Status</th>
              <th className="py-1 text-right">Lines</th>
              <th className="py-1 text-right">Budget</th>
            </tr>
          </thead>
          <tbody>
            {d.avance.por_estado.map((e) => (
              <tr key={e.estado} className="border-b border-slate-50">
                <td className="py-0.5">
                  <span
                    className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                    style={{ background: STATE_COLOR[e.estado] ?? GRIS }}
                  />
                  {e.estado}
                </td>
                <td className="tabular py-0.5 text-right">{e.lineas}</td>
                <td className="tabular py-0.5 text-right">{moneyUsd(e.presupuesto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* ⚠️ Honestidad sobre el dato: con una sola línea en Completed, el
            porcentaje por hito no mide avance de obra. Decirlo vale más que
            mostrar un 3.9% que nadie puede usar. */}
        <p className="mt-2 text-[10px] text-slate-400">
          Milestone progress reads {d.avance.pct_por_hito.toFixed(1)}%, well below the cost figure,
          because the status field tracks budget approval rather than work finished. Treat the cost
          figure as the live one until statuses are maintained.
        </p>
      </div>
    </div>
  );
}

/* ── 4 · Qué falta ───────────────────────────────────────────────────────── */

function Pendiente({ d }: { d: DashboardSummary }) {
  const secs = d.pendiente.secciones.filter((s) => s.remaining > 0.5);
  const barras = secs.map((s) => ({
    name: s.category.length > 18 ? `${s.category.slice(0, 17)}…` : s.category,
    committed: s.por_pagar,
    open: s.sin_comprometer,
  }));
  return (
    <div className="space-y-4">
      <Titulo t="What is left" sub="— and how much of it is already locked in" />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 lg:col-span-2">
          <p className="mb-2 text-sm font-semibold text-slate-600">
            Remaining by section — committed vs still open
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barras} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => compactMoney(v)} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
              <Tooltip
                formatter={(v: number | string) => moneyUsd(v as number)}
                contentStyle={{ fontSize: 11 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="committed" name="Under contract" stackId="a" fill={VERDE} />
              <Bar dataKey="open" name="No contract yet" stackId="a" fill={AMBAR} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-600">Cash calls ahead</p>
          <table className="w-full text-[11px]">
            <tbody>
              {d.pendiente.llamados.map((l) => (
                <tr key={l.desde} className="border-b border-slate-50">
                  <td className="py-1">{trimestre(l.desde)}</td>
                  <td className="tabular py-1 text-right font-semibold">{moneyUsd(l.monto)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-700 font-bold">
                <td className="py-1">TOTAL</td>
                <td className="tabular py-1 text-right">
                  {moneyUsd(d.pendiente.llamados.reduce((a, l) => a + l.monto, 0))}
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-slate-400">
            What the schedule asks for, by quarter. Owners have wired {moneyUsd(d.aporte_duenos)}{" "}
            into the project so far.
          </p>
        </div>
      </div>

      {/* El detalle por sección, con el porcentaje ejecutado. */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-[11px]">
          <thead className="bg-slate-100 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2">Section</th>
              <th className="px-3 py-2 text-right">Lines</th>
              <th className="px-3 py-2 text-right">Budget</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-right">Under contract</th>
              <th className="px-3 py-2 text-right">No contract yet</th>
              <th className="px-3 py-2 text-right">Remaining</th>
              <th className="px-3 py-2 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {d.pendiente.secciones.map((s) => (
              <tr key={s.category} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-1 font-semibold text-teal-900">{s.category}</td>
                <td className="tabular px-3 py-1 text-right text-slate-400">{s.lineas}</td>
                <td className="tabular px-3 py-1 text-right">{moneyUsd(s.budget_revised)}</td>
                <td className="tabular px-3 py-1 text-right">{moneyUsd(s.spend)}</td>
                <td className="tabular px-3 py-1 text-right text-emerald-700">
                  {s.por_pagar ? moneyUsd(s.por_pagar) : "—"}
                </td>
                <td className="tabular px-3 py-1 text-right text-amber-700">
                  {s.sin_comprometer ? moneyUsd(s.sin_comprometer) : "—"}
                </td>
                <td className="tabular px-3 py-1 text-right font-semibold">
                  {moneyUsd(s.remaining)}
                </td>
                <td className="tabular px-3 py-1 text-right text-slate-500">{s.pct.toFixed(0)}%</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-800 bg-[#C8DCF0] font-bold">
              <td className="px-3 py-2">TOTAL</td>
              <td className="tabular px-3 py-2 text-right">
                {d.pendiente.secciones.reduce((a, s) => a + s.lineas, 0)}
              </td>
              <td className="tabular px-3 py-2 text-right">{moneyUsd(d.costo.budget_revised)}</td>
              <td className="tabular px-3 py-2 text-right">{moneyUsd(d.costo.pagado)}</td>
              <td className="tabular px-3 py-2 text-right">{moneyUsd(d.costo.por_pagar)}</td>
              <td className="tabular px-3 py-2 text-right">{moneyUsd(d.costo.sin_comprometer)}</td>
              <td className="tabular px-3 py-2 text-right">{moneyUsd(d.costo.remanente)}</td>
              <td className="tabular px-3 py-2 text-right">{d.avance.pct_por_costo.toFixed(0)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Permisos y líneas marcadas: lo que hay que destrabar. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-600">
            Permits and approvals
            <span className="ml-2 font-normal text-slate-400">
              — the gate on a ground-up project
            </span>
          </p>
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-[11px]">
              <tbody>
                {d.pendiente.permisos.map((p) => (
                  <tr key={p.wbs_code} className="border-b border-slate-50">
                    <td className="px-3 py-1 font-mono text-[10px] text-blue-700">{p.wbs_code}</td>
                    <td className="px-3 py-1">{p.title}</td>
                    <td className="px-3 py-1 text-slate-400">{p.state ?? "—"}</td>
                    <td className="tabular px-3 py-1 text-right">{moneyUsd(p.budget_revised)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-amber-300 bg-white">
          <p className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
            Flagged Attention
            <span className="ml-2 font-normal text-amber-700">— the team already marked these</span>
          </p>
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-[11px]">
              <tbody>
                {d.pendiente.atencion.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-400">Nothing flagged.</td>
                  </tr>
                ) : (
                  d.pendiente.atencion.map((l) => (
                    <tr key={l.wbs_code} className="border-b border-slate-50">
                      <td className="px-3 py-1 font-mono text-[10px] text-blue-700">
                        {l.wbs_code}
                      </td>
                      <td className="px-3 py-1">{l.title}</td>
                      <td className="tabular px-3 py-1 text-right font-semibold">
                        {moneyUsd(l.remaining)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── La pantalla ─────────────────────────────────────────────────────────── */

export function DashboardView() {
  const q = useDashboard();

  if (q.isLoading) return <p className="text-sm text-slate-500">Loading dashboard…</p>;
  if (q.isError)
    return (
      <p className="text-sm text-red-600">
        Could not load the dashboard: {(q.error as Error).message}
      </p>
    );
  const d = q.data;
  if (!d) return null;

  return (
    <div className="space-y-6">
      <EnQueTermina d={d} />
      <Adelantados d={d} />
      <div>
        <Titulo t="How it is going" />
        <Avance d={d} />
      </div>
      <Pendiente d={d} />

      <p className="text-[11px] text-slate-400">
        Figures as of {d.fecha}, from the LEDGER and the Job Cost schedule.{" "}
        <b>Profit on cost, yield on cost and IRR are not shown</b> because the system does not hold
        the project&apos;s expected value (GDV): there is {moneyUsd(d.costo.budget_revised)} of cost
        against a single unrealised sale line. Once the expected value is captured, the margin
        computes against the anticipated final cost and nothing else here changes.
      </p>
    </div>
  );
}
