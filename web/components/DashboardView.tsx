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
import { type ReactNode, useState } from "react";
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

const TEAL = "#005C40";
const AZUL = "#1161AA";
const GRIS = "#99A49D";
const ROJO = "#C52A38";
const AMBAR = "#FF7B2F";
const VERDE = "#2F956E";

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

/**
 * Una tarjeta del tablero.
 *
 * Owner, 2026-11-10: *«todo lo que se diga aca puede ser usado en mi contra..
 * esto es para un dueno..ocupo suavisar la narrativa y desplegar el dato al
 * hacer click y que diga lo que realmente es»*.
 *
 * ⚠️ Y tenia razon: el tablero EDITORIALIZABA. «a LEDGER row with an amount and
 * no payment recorded» o «the project runs with no reserve» se leen como un
 * juicio sobre quien lleva los libros, no como un hecho de obra. El numero era
 * correcto; el adjetivo no le correspondia a la pantalla.
 *
 * La regla que queda: **arriba el termino, abajo el detalle.** El rotulo nombra
 * el concepto en lenguaje de obra y el `detalle` —a un clic— dice exactamente
 * que mide, de donde sale y donde verlo fila por fila.
 *
 * ⚠️ Suavizar NO es esconder: los montos no cambian ni un centavo y el detalle
 * dice la verdad completa. Lo unico que se fue son los adjetivos.
 */
function Kpi({
  label,
  value,
  sub,
  tono,
  grande,
  detalle,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tono?: "ok" | "warn" | "bad";
  grande?: boolean;
  /** Lo que de verdad es. Se abre al hacer clic en la tarjeta. */
  detalle?: ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  // Los dos colores de estado de glif: el borde lleva el color exacto y el
  // fondo queda en el tinte suave de Tailwind. Pintar el fondo con el naranja
  // entero deja el numero ilegible, que es justo lo contrario de lo que una
  // senal de alerta tiene que hacer.
  const borde =
    tono === "bad"
      ? "border-peligro bg-red-50"
      : tono === "warn"
        ? "border-alerta bg-amber-50"
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
  const cuerpo = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
        {detalle ? (
          <span className="shrink-0 text-xs text-slate-400">{abierto ? "−" : "+"}</span>
        ) : null}
      </div>
      <div className={`tabular font-bold ${grande ? "text-2xl" : "text-xl"} ${color}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </>
  );

  if (!detalle) return <div className={`rounded-lg border p-3 ${borde}`}>{cuerpo}</div>;

  return (
    <div className={`rounded-lg border ${borde}`}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="w-full p-3 text-left transition hover:bg-black/[0.02]"
      >
        {cuerpo}
      </button>
      {abierto ? (
        <div className="border-t border-slate-200/70 px-3 py-2 text-xs leading-relaxed text-slate-600">
          {detalle}
        </div>
      ) : null}
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
      <Titulo t="Where the project lands" sub="— the revised budget, and how much of it is spent" />
      {/* ⚠️ Eran CINCO tarjetas y la primera decia «Anticipated final cost»
          sobre un numero que es, al centavo, el presupuesto revisado: en la
          formula el comprometido entra y sale, y se cancela. Presentar el
          presupuesto como si fuera un pronostico es afirmar algo que nadie
          midio. Owner, 2026-11-10: «todo lo que se ponga aca debe tener
          sentido, sino mejor no ponerlo». */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Revised budget"
          value={moneyUsd(c.budget_revised)}
          sub="original + approved changes"
          grande
          detalle={
            <>
              What the Job Cost carries today, and also the expected final cost: no line is
              currently forecast above its own budget, so the two are the same number. If a line
              were forecast over, this is where it would show first.
            </>
          }
        />
        <Kpi
          label="Approved changes"
          value={money$(c.variacion_vs_original)}
          sub={`+${c.crecimiento_pct.toFixed(1)}% over the original ${moneyUsd(c.budget_original)}`}
          detalle={
            <>
              The difference between the revised budget and the original one, from change orders
              approved during the project. It is a record of decisions already taken, not a variance
              against plan. The line-by-line detail is in <b>Job Cost</b>.
            </>
          }
        />
        <Kpi
          label="Paid to date"
          value={moneyUsd(c.pagado)}
          sub={`${d.avance.pct_por_costo.toFixed(1)}% of the revised budget`}
          detalle={
            <>
              Sum of <code>Amount Paid</code> on the LEDGER. Every payment that has actually left
              the account, line by line in <b>Ledger</b>.
            </>
          }
        />
        <Kpi
          label="Approved, pending payment"
          value={moneyUsd(c.por_pagar)}
          sub="recorded on the LEDGER, not yet disbursed"
          detalle={
            <>
              <code>Amount</code> minus <code>Amount Paid</code> on the LEDGER rows that still carry
              a balance — work already approved whose payment has not gone out yet. The row-by-row
              breakdown, tied back to the bank balance, is in <b>Banking → Balance bridge</b>.
            </>
          }
        />
        <Kpi
          label="Still to be committed"
          value={moneyUsd(c.sin_comprometer)}
          sub="budget not yet assigned to a payment"
          detalle={
            <>
              The rest of the revised budget: scope that is planned and funded but for which nothing
              has been requested yet. On a project in progress this is the normal state of the work
              ahead — it is neither a shortfall nor a missing record.
            </>
          }
        />
      </div>

      {/* La cascada del presupuesto: de dónde salió el número revisado. */}
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
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
                // ⚠️ POSITIVOS. Iban en negativo, como si se restaran del
                // revisado, y por eso la fila del pie no cerraba con nada: los
                // tres no se le restan, lo COMPONEN. Mostrarlos en rojo con
                // signo menos hacia leer como salidas tres cifras que son el
                // reparto del mismo presupuesto.
                ["· Paid", c.pagado, "already disbursed"],
                ["· Approved, pending payment", c.por_pagar, "recorded, not yet disbursed"],
                ["· Still to be committed", c.sin_comprometer, "nothing requested against it yet"],
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
            {/* ⚠️ Decia «ANTICIPATED FINAL COST» y mostraba el mismo numero del
                presupuesto revisado dos filas mas arriba, sin que las filas de
                en medio lo explicaran: los tres tramos SON el revisado, no se
                le restan. Ahora la fila dice la aritmetica que de verdad hay. */}
            <tr className="border-t-2 border-slate-700 bg-[#D8F4E6] font-bold">
              <td className="px-3 py-1">PAID + PENDING + STILL TO COMMIT</td>
              <td className="tabular px-3 py-1 text-right">{moneyUsd(c.anticipated_final_cost)}</td>
              <td className="px-3 py-1 font-normal text-slate-500">
                the three add back to the revised budget
              </td>
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
      {/* ⚠️ Se llamaba «Early warnings» y pintaba de rojo cuatro de cinco
          tarjetas. Un tablero que grita en todas no senala nada, y para un
          dueno se lee como un reporte de problemas y no como el estado de la
          obra. El color queda SOLO donde hay algo que decidir -- la caja. */}
      <Titulo
        t="What to watch"
        sub="— indicators that move before the cost does. Click any card for what it measures"
      />
      {/* ⚠️ Salieron dos tarjetas que no agregaban nada:
          · «Of the remaining, still to commit %» era `still to be committed`
            dividido por el remanente, y los dos sumandos ya estan arriba;
          · «Approved changes vs original %» era la tarjeta Approved changes
            expresada en porcentaje. Ese porcentaje ahora vive en el subtitulo
            de esa misma tarjeta, que es donde pertenece.
          Repetir un numero con otro nombre no lo confirma: solo hace que el
          tablero parezca decir mas de lo que midio. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi
          label="Contingency"
          value={ct.existe ? moneyUsd(ct.queda) : "not set up"}
          sub={
            ct.existe
              ? `${consumidaPct.toFixed(0)}% used against ${d.avance.pct_por_costo.toFixed(0)}% of the work`
              : "no line is marked as contingency"
          }
          tono={ct.existe && adelantada ? "warn" : undefined}
          detalle={
            ct.existe ? (
              <>
                Reserve left, and how much of it has been used against how much of the work is done.
                The warning sign is reserve running ahead of progress.
              </>
            ) : (
              <>
                No line in the Job Cost is marked as contingency, so the reserve-versus-progress
                indicator cannot be built. Ground-up projects commonly carry 5–10% of hard costs.
                How much to reserve is a money decision for the owner — marking a line as
                contingency in <b>Job Cost</b> starts the tracking.
              </>
            )
          }
        />
        <Kpi
          label="Lines marked for review"
          value={a.atencion_lineas}
          sub={`${moneyUsd(a.atencion_remanente)} still to spend on them`}
          detalle={
            <>
              Job Cost lines someone set to <b>Attention</b> so they get a second look. It is a
              marker the team places by hand, not something the system infers.
            </>
          }
        />
        <Kpi
          label={`Funding for the next ${d.dias_caja} days`}
          value={money$(-a.caja_faltante)}
          sub={`${moneyUsd(a.caja_hoy)} in the bank · ${moneyUsd(a.caja_pide_90)} scheduled`}
          tono={a.caja_faltante > 0 ? "warn" : "ok"}
          detalle={
            <>
              Cash in the bank today against what the schedule calls for over the next {d.dias_caja}{" "}
              days. A negative figure is the size of the next draw, which is how a draw-funded
              project normally runs — it is not an overdraft. The bank side is in{" "}
              <b>Banking → Balance bridge</b>.
            </>
          }
        />
      </div>

      {/* ⚠️ Acá vivían DOS párrafos explicando las tarjetas: uno gris con la
          definición de dos de ellas y uno ámbar sobre la contingencia. Los dos
          se leían como un descargo —la pantalla justificándose— y el ámbar
          ponía un ⚠ grande sobre algo que es una decisión del dueño, no una
          falla. Owner, 2026-11-10: *«ocupo suavisar la narrativa y desplegar el
          dato al hacer click y que diga lo que realmente es»*.

          El texto no se perdió: está completo dentro del `detalle` de la
          tarjeta que le corresponde, a un clic. Cada explicación al lado de su
          número, en vez de un muro al pie que nadie relaciona con nada. */}
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
        <p className="mb-2 text-xs text-slate-400">
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
        <p className="mb-3 text-xs text-slate-400">
          By cost is a proxy: money does not move at the same pace as the work.
        </p>
        <div className="mb-3">
          <div className="flex items-baseline justify-between text-xs text-slate-500">
            <span>By cost</span>
            <span className="tabular font-bold text-slate-800">
              {d.avance.pct_por_costo.toFixed(1)}%
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded bg-slate-200">
            <div
              className="h-full rounded bg-[#1161AA]"
              style={{ width: `${Math.min(d.avance.pct_por_costo, 100)}%` }}
            />
          </div>
        </div>
        <table className="w-full text-xs">
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
        <p className="mt-2 text-xs text-slate-400">
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
            Remaining by section — approved vs still to commit
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
              <Bar dataKey="committed" name="Approved, pending payment" stackId="a" fill={VERDE} />
              <Bar dataKey="open" name="Still to be committed" stackId="a" fill={AMBAR} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-semibold text-slate-600">Cash calls ahead</p>
          <table className="w-full text-xs">
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
          <p className="mt-2 text-xs text-slate-400">
            What the schedule asks for, by quarter. Owners have wired {moneyUsd(d.aporte_duenos)}{" "}
            into the project so far.
          </p>
        </div>
      </div>

      {/* El detalle por sección, con el porcentaje ejecutado. */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-100 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2">Section</th>
              <th className="px-3 py-2 text-right">Lines</th>
              <th className="px-3 py-2 text-right">Budget</th>
              <th className="px-3 py-2 text-right">Paid</th>
              <th className="px-3 py-2 text-right">Billed, not paid</th>
              <th className="px-3 py-2 text-right">Not in LEDGER</th>
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
            <tr className="border-t-2 border-slate-800 bg-[#B8E8D2] font-bold">
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
            <table className="w-full text-xs">
              <tbody>
                {d.pendiente.permisos.map((p) => (
                  <tr key={p.wbs_code} className="border-b border-slate-50">
                    <td className="px-3 py-1 font-mono text-xs text-blue-700">{p.wbs_code}</td>
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
            <table className="w-full text-xs">
              <tbody>
                {d.pendiente.atencion.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-400">Nothing flagged.</td>
                  </tr>
                ) : (
                  d.pendiente.atencion.map((l) => (
                    <tr key={l.wbs_code} className="border-b border-slate-50">
                      <td className="px-3 py-1 font-mono text-xs text-blue-700">{l.wbs_code}</td>
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

      <p className="text-xs text-slate-400">
        Figures as of {d.fecha}, from the LEDGER and the Job Cost schedule.{" "}
        <b>Profit on cost, yield on cost and IRR are not shown</b> because the system does not hold
        the project&apos;s expected value (GDV): there is {moneyUsd(d.costo.budget_revised)} of cost
        against a single unrealised sale line. Once the expected value is captured, the margin
        computes against the anticipated final cost and nothing else here changes.
      </p>
    </div>
  );
}
