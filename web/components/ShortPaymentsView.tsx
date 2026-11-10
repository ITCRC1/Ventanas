"use client";

import { ApiError, api } from "@/lib/api";
import { rawNum, usd2 } from "@/lib/format";
import {
  useAddShortLine,
  useCategories,
  useCreateDisbursement,
  useCycleStatus,
  useDeleteShortLine,
  useMe,
  usePayees,
  usePhases,
  usePreloadRecurring,
  useReopenDisbursement,
  useRunMonth,
  useShortPayments,
  useUpdateDisbNo,
  useUpdateShortLine,
  useWbsList,
  useWbsSuggestions,
} from "@/lib/hooks";
import type { WbsSuggestion } from "@/lib/hooks";
import type { Category, Payee, Phase, ShortPaymentBatch, ShortPaymentLine, Wbs } from "@/lib/types";
import {
  BTN_EXCEL,
  BTN_REABRIR,
  CABECERA,
  CELL_PLANA,
  ESTADO_ROTULO,
  TABLA,
  TFOOT,
  TH,
  THEAD,
  chipEstado,
  rotuloEstado,
} from "@/lib/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

// ⚠️ Acá vivía una TERCERA copia del mismo formateador de dinero ($14,125.00),
// idéntica a `usd2` de lib/format y a la que tenía Disbursements. Una sola.

const STATUS_LABEL = ESTADO_ROTULO;

function batchTitle(b: ShortPaymentBatch): string {
  const d = b.send_date ?? b.period_month;
  const dt = new Date(`${d}T00:00:00`);
  return dt.toLocaleDateString("en", {
    day: b.send_date ? "numeric" : undefined,
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function TransferBadge({ t }: { t: string | null }) {
  if (!t) return null;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
        t.toUpperCase() === "SEND"
          ? "bg-emerald-100 text-emerald-700"
          : "bg-amber-100 text-amber-700"
      }`}
    >
      {t}
    </span>
  );
}

// ⚠️ El tamaño de celda, el chip de estado y los botones viven en lib/ui:
// son los MISMOS que la vista de Disbursements, que es la que el owner
// aprobó. Copiarlos acá es como se separaron la vez pasada.
// ⚠️ Payments usa la celda PLANA: diez filas x seis campos eran sesenta
// recuadros peleando, y la mitad repetian el mismo texto. Disbursements
// sigue con CELL (con borde) porque es la vista que el owner aprobo.
const CELL_INPUT = CELL_PLANA;

// WBS / Project Number (código + título como tooltip). Solo lectura.
function WbsCell({ line }: { line: ShortPaymentLine }) {
  if (!line.wbs_code) return <span className="text-slate-300">—</span>;
  return (
    <span className="font-mono text-xs text-slate-600" title={line.wbs_title ?? undefined}>
      {line.wbs_code}
    </span>
  );
}

// WBS editable: se escribe el nº de proyecto acá y ya viaja al Ledger y al Job
// Cost (antes había que asignarlo a mano en el Ledger, línea por línea).
function WbsEdit({
  line,
  wbsList,
  save,
  suggestion,
}: {
  line: ShortPaymentLine;
  wbsList: Wbs[];
  save: (body: { wbs_id: number | null }) => void;
  suggestion?: WbsSuggestion;
}) {
  const [code, setCode] = useState(line.wbs_code ?? "");
  const match = wbsList.find((w) => w.wbs_code === code.trim());
  // Solo se ofrece si la línea sigue sin proyecto: es una propuesta, no un default.
  const show = suggestion && !line.wbs_code && !code.trim();
  return (
    /* ⚠️ El chip va AL LADO, no debajo. Apilado hacía que solo las filas CON
       sugerencia midieran mas alto: en la tanda #29 las cuatro primeras se
       veian mas grandes que las otras seis y la tabla quedaba dispareja. Es lo
       que el owner leyo como «desordenado» (2026-11-10). */
    <div className="flex items-center gap-1">
      <input
        list="wbs-codes"
        value={code}
        placeholder="—"
        title={match?.title ?? line.wbs_title ?? "Project number"}
        onChange={(e) => setCode(e.target.value)}
        onBlur={() => {
          const v = code.trim();
          if (v === (line.wbs_code ?? "")) return;
          if (v === "") return save({ wbs_id: null });
          const w = wbsList.find((x) => x.wbs_code === v);
          if (!w) {
            setCode(line.wbs_code ?? ""); // no existe ese proyecto → revertir
            return;
          }
          save({ wbs_id: w.id });
        }}
        className={`w-14 rounded border px-1 py-0.5 text-center font-mono text-sm transition focus:outline-none ${
          code && !match
            ? "border-red-300 bg-red-50"
            : "border-transparent bg-transparent hover:border-slate-300 hover:bg-white focus:border-slate-400 focus:bg-white"
        }`}
      />
      {show && suggestion ? (
        <button
          type="button"
          title={`${suggestion.wbs_title ?? ""} — ${suggestion.reason}. Click to use it.`}
          onClick={() => {
            setCode(suggestion.wbs_code);
            save({ wbs_id: suggestion.wbs_id });
          }}
          className="shrink-0 rounded bg-amber-100 px-1 font-mono text-xs leading-5 text-amber-800 hover:bg-amber-200"
        >
          {suggestion.wbs_code}
        </button>
      ) : null}
    </div>
  );
}

// Categoría (arriba) / Tipo-Fase (abajo, atenuado). Heredados del WBS si la línea no los trae.
function CatTypeCell({ line }: { line: ShortPaymentLine }) {
  if (!line.category && !line.type) return <span className="text-slate-300">—</span>;
  return (
    <div className="leading-tight">
      <div className="text-slate-600">{line.category ?? "—"}</div>
      {line.type ? <div className="text-xs text-slate-400">{line.type}</div> : null}
    </div>
  );
}

// Category / Type editables: la categoría fija la línea y el tipo lista las fases
// de esa categoría. Vacío = hereda del WBS (o queda en blanco si no hay WBS).
function CatTypeEdit({
  line,
  save,
  categories,
  phases,
}: {
  line: ShortPaymentLine;
  save: (body: { category_id?: number | null; phase_id?: number | null }) => void;
  categories: Category[];
  phases: Phase[];
}) {
  const catId = line.category_id ?? "";
  const catPhases = phases.filter((p) => p.category_id === line.category_id);
  // ⚠️ LADO A LADO, no apilados. Apilados hacían que CADA fila midiera el
  // doble que las demás: diez líneas ocupaban lo que ahora ocupan veinte.
  const SEL =
    "min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs " +
    "transition hover:border-slate-300 hover:bg-white focus:border-slate-400 focus:bg-white";
  return (
    <div className="flex gap-1">
      <select
        className={SEL}
        value={catId}
        onChange={(e) => {
          const v = e.target.value ? Number(e.target.value) : null;
          // Al cambiar de categoría, la fase anterior ya no aplica.
          save({ category_id: v, phase_id: null });
        }}
      >
        <option value="">
          {line.category_id
            ? "— Clear —"
            : line.category
              ? `${line.category} (from WBS)`
              : "— Category —"}
        </option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        className={SEL}
        value={line.phase_id ?? ""}
        disabled={!line.category_id}
        onChange={(e) => save({ phase_id: e.target.value ? Number(e.target.value) : null })}
        title={line.category_id ? "" : "Pick a category first"}
      >
        <option value="">
          {line.phase_id ? "— Clear —" : line.type ? `${line.type} (from WBS)` : "— Type —"}
        </option>
        {catPhases.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// Número de Disbursement editable (numeración oficial). Corregible por si hay error.
function BatchNo({ b, editable }: { b: ShortPaymentBatch; editable: boolean }) {
  const upd = useUpdateDisbNo();
  const [no, setNo] = useState(String(b.disb_no));

  if (!editable) {
    return (
      <>
        #{b.disb_no}.{b.disb_sub}
      </>
    );
  }
  return (
    <>
      #
      <input
        type="number"
        className="mx-0.5 w-12 rounded border border-slate-400 bg-white px-1 py-0 text-xs text-slate-900"
        value={no}
        onChange={(e) => setNo(e.target.value)}
        onBlur={async () => {
          const n = Number(no);
          if (!n || n === b.disb_no) return;
          try {
            await upd.mutateAsync({ id: b.id, disb_no: n });
          } catch (err) {
            setNo(String(b.disb_no)); // revertir en pantalla
            if (err instanceof ApiError) alert(err.problem.detail ?? err.problem.title);
          }
        }}
      />
      .{b.disb_sub}
    </>
  );
}

// Cuerpo de la tabla de una tanda. Es un componente propio para poder pedir acá
// las sugerencias de proyecto de ESA tanda: un hook no puede vivir dentro del
// .map de tandas.
function LinesBody({
  batch,
  editable,
  showBank,
  payees,
  categories,
  phases,
  wbsList,
  preCols,
}: {
  batch: ShortPaymentBatch;
  editable: boolean;
  showBank: boolean;
  payees: Payee[];
  categories: Category[];
  phases: Phase[];
  wbsList: Wbs[];
  preCols: number;
}) {
  // Solo en borrador: en una tanda cerrada no hay nada que asignar.
  const sug = useWbsSuggestions(batch.id, editable);
  const byLine = useMemo(() => {
    const m = new Map<number, WbsSuggestion>();
    for (const x of sug.data ?? []) m.set(x.line_id, x);
    return m;
  }, [sug.data]);

  return (
    <tbody className="divide-y divide-slate-100">
      {batch.lines.map((l) => (
        <LineRow
          key={l.id ?? l.line_no}
          line={l}
          disbId={batch.id}
          editable={editable}
          showBank={showBank}
          payees={payees}
          categories={categories}
          phases={phases}
          wbsList={wbsList}
          suggestion={l.id != null ? byLine.get(l.id) : undefined}
        />
      ))}
      {editable ? <AddLineRow disbId={batch.id} preCols={preCols} /> : null}
    </tbody>
  );
}

function LineRow({
  line,
  disbId,
  editable,
  showBank,
  payees,
  categories,
  phases,
  wbsList,
  suggestion,
}: {
  line: ShortPaymentLine;
  disbId: number;
  editable: boolean;
  showBank: boolean;
  payees: Payee[];
  categories: Category[];
  phases: Phase[];
  wbsList: Wbs[];
  suggestion?: WbsSuggestion;
}) {
  const upd = useUpdateShortLine();
  const del = useDeleteShortLine();
  const [desc, setDesc] = useState(line.description);
  const [inv, setInv] = useState(line.invoice_no ?? "");
  const [nota, setNota] = useState(line.reason ?? "");
  const [amt, setAmt] = useState(line.amount);
  const [name, setName] = useState(line.payee_name ?? "");

  const save = (body: {
    description?: string;
    invoice_no?: string;
    reason?: string;
    amount?: number;
    transfer?: string;
    payee_id?: number;
    payee_name?: string | null;
    category_id?: number | null;
    phase_id?: number | null;
    wbs_id?: number | null;
  }) => {
    if (line.id == null) return;
    upd.mutate({ disbId, lineId: line.id, body });
  };
  const saveName = () => {
    const nm = name.trim();
    if (nm === (line.payee_name ?? "")) return;
    const p = payees.find((x) => x.name === nm);
    // Proveedor del catálogo → trae banco/beneficiario/IBAN; nombre nuevo → se
    // crea el proveedor (solo el nombre); vacío → la línea queda sin proveedor.
    if (p) save({ payee_id: p.id });
    else save({ payee_name: nm || null });
  };

  if (!editable) {
    return (
      <tr className="hover:bg-slate-50">
        <td className="px-2 py-1 text-slate-400">{line.line_no}</td>
        <td className="px-2 py-1">
          <WbsCell line={line} />
        </td>
        <td className="px-2 py-1">{line.description}</td>
        <td className="px-2 py-1 text-slate-500">{line.invoice_no ?? ""}</td>
        <td className="px-2 py-1 text-slate-500">{line.reason ?? ""}</td>
        <td className="px-2 py-1">
          <CatTypeCell line={line} />
        </td>
        <td className="px-2 py-1 text-slate-600">{line.payee_name ?? ""}</td>
        <td className="px-2 py-1 text-center">
          <TransferBadge t={line.transfer} />
        </td>
        {showBank ? (
          <td
            className="max-w-[12rem] truncate px-2 py-1 text-slate-500"
            title={line.bank_name ?? ""}
          >
            {line.bank_name ?? ""}
          </td>
        ) : null}
        <td className="tabular px-2 py-1 text-right">{usd2(line.amount)}</td>
      </tr>
    );
  }

  return (
    <tr className="group hover:bg-slate-50/60">
      <td className="px-2 py-1 text-slate-400">{line.line_no}</td>
      <td className="px-1 py-0.5">
        <WbsEdit line={line} wbsList={wbsList} save={save} suggestion={suggestion} />
      </td>
      <td className="px-1 py-0.5">
        <input
          className={CELL_INPUT}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc !== line.description && save({ description: desc })}
        />
      </td>
      <td className="px-1 py-0.5">
        <input
          className={CELL_INPUT}
          placeholder="Invoice #"
          value={inv}
          onChange={(e) => setInv(e.target.value)}
          onBlur={() => inv !== (line.invoice_no ?? "") && save({ invoice_no: inv })}
        />
      </td>
      <td className="px-1 py-0.5">
        <input
          className={CELL_INPUT}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          onBlur={() => nota !== (line.reason ?? "") && save({ reason: nota })}
        />
      </td>
      <td className="px-1 py-0.5">
        <CatTypeEdit line={line} save={save} categories={categories} phases={phases} />
      </td>
      {/* Nombre: elegís el proveedor → replica banco/beneficiario/IBAN */}
      <td className="px-1 py-0.5">
        <input
          list="payee-names"
          className={CELL_INPUT}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
        />
      </td>
      <td className="px-1 py-0.5 text-center">
        <select
          className="rounded border border-transparent bg-transparent px-1 py-0.5 text-xs transition hover:border-slate-300 hover:bg-white focus:border-slate-400 focus:bg-white"
          value={line.transfer ?? ""}
          onChange={(e) => save({ transfer: e.target.value })}
        >
          <option value="">—</option>
          <option value="SEND">SEND</option>
          <option value="HOLD">HOLD</option>
          <option value="LAFISE">LAFISE</option>
        </select>
      </td>
      {/* ⚠️ Truncado: el banco es el mismo en todas las filas y repetirlo
          entero empujaba la columna del monto fuera de la pantalla. */}
      {showBank ? (
        <td
          className="max-w-[12rem] truncate px-2 py-1 text-slate-500"
          title={line.bank_name ?? ""}
        >
          {line.bank_name ?? ""}
        </td>
      ) : null}
      <td className="px-1 py-0.5">
        {/* Muestra $#,##0.00; al enfocar deja el número plano para editarlo.
            Es el mismo campo que la vista de Disbursements. */}
        <input
          key={line.amount}
          defaultValue={usd2(line.amount)}
          className={`${CELL_INPUT} tabular text-right`}
          onFocus={(e) => {
            e.target.value = rawNum(e.target.value);
            e.target.select();
          }}
          onBlur={(e) => {
            const v = rawNum(e.target.value);
            e.target.value = usd2(v === "" ? 0 : v);
            if (Number(v || 0) !== Number(line.amount)) save({ amount: Number(v || 0) });
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </td>
      <td className="px-1 py-0.5 text-center">
        <button
          type="button"
          title="Delete line"
          className="rounded px-1.5 text-red-500 opacity-0 transition hover:bg-red-50 focus:opacity-100 group-hover:opacity-100"
          onClick={() => line.id != null && del.mutate({ disbId, lineId: line.id })}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

function AddLineRow({ disbId, preCols }: { disbId: number; preCols: number }) {
  const add = useAddShortLine();
  const [desc, setDesc] = useState("");
  const [amt, setAmt] = useState("");
  const [transfer, setTransfer] = useState("SEND");

  const submit = () => {
    if (!desc.trim() || !amt) return;
    add.mutate(
      { disbId, body: { description: desc.trim(), amount: Number(amt), transfer } },
      {
        onSuccess: () => {
          setDesc("");
          setAmt("");
        },
      },
    );
  };

  return (
    <tr className="bg-slate-50">
      <td className="px-2 py-1 text-slate-300">+</td>
      <td className="px-1 py-1" colSpan={preCols - 1}>
        <input
          className={CELL_INPUT}
          placeholder="New line — description"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </td>
      <td className="px-1 py-1 text-right">
        <div className="flex items-center justify-end">
          <span className="mr-0.5 text-slate-400">$</span>
          <input
            type="number"
            className={`${CELL_INPUT} text-right`}
            placeholder="Amount"
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
          />
        </div>
      </td>
      <td className="px-1 py-1 text-center">
        <div className="flex items-center gap-1">
          <select
            className="rounded border border-slate-300 bg-white px-1 py-0.5 text-xs"
            value={transfer}
            onChange={(e) => setTransfer(e.target.value)}
          >
            <option value="SEND">SEND</option>
            <option value="HOLD">HOLD</option>
            <option value="LAFISE">LAFISE</option>
          </select>
          <button
            type="button"
            disabled={!desc.trim() || !amt || add.isPending}
            onClick={submit}
            className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </td>
    </tr>
  );
}

// Numeración del owner: Enero-2026 = #19, un número por mes consecutivo.
function disbNoFor(ym: string): number {
  const [y, m] = ym.split("-").map(Number);
  return 19 + (y - 2026) * 12 + (m - 1);
}

const monthName = (ym: string) =>
  new Date(`${ym}-01T00:00:00`).toLocaleDateString("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

// Abrir la tanda del mes siguiente sin salir de esta pantalla: crea el
// desembolso (el # sale del mes) y, si se marca, precarga los 4 recurrentes.
function NewBatchBar({ batches }: { batches: ShortPaymentBatch[] }) {
  const create = useCreateDisbursement();
  const preload = usePreloadRecurring();
  const qc = useQueryClient();
  const next = useMemo(() => {
    const last = batches
      .map((b) => b.period_month.slice(0, 7))
      .sort()
      .at(-1);
    const d = last ? new Date(`${last}-01T00:00:00Z`) : new Date();
    d.setUTCMonth(d.getUTCMonth() + (last ? 1 : 0));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }, [batches]);

  const [month, setMonth] = useState(next);
  const [withRecurring, setWithRecurring] = useState(true);
  const [busy, setBusy] = useState(false);
  // Si cambian las tandas (creé una), el mes propuesto se mueve al siguiente.
  useEffect(() => setMonth(next), [next]);

  const taken = batches.find((b) => b.period_month.slice(0, 7) === month);
  const valid = /^\d{4}-\d{2}$/.test(month);

  const submit = async () => {
    // `taken` ya no bloquea: un mes puede tener varias tandas y el backend le
    // asigna el siguiente sub libre.
    if (!valid || busy) return;
    setBusy(true);
    try {
      const d = await create.mutateAsync({
        period_month: `${month}-01`,
        send_date: `${month}-01`,
      });
      if (withRecurring) await preload.mutateAsync({ id: d.id });
      // Refetch explícito: la tanda nueva tiene que aparecer sin recargar.
      await qc.refetchQueries({ queryKey: ["short-payments"] });
    } catch (err) {
      alert(
        err instanceof ApiError
          ? (err.problem.detail ?? err.problem.title)
          : "Could not create the batch.",
      );
    } finally {
      setBusy(false);
    }
  };

  // El siguiente sub libre de ese número. La primera tanda del mes es .0 y
  // las que vengan después se numeran solas: .1, .2…
  const proximoSub = valid
    ? Math.max(
        -1,
        ...(batches ?? []).filter((b) => b.disb_no === disbNoFor(month)).map((b) => b.disb_sub),
      ) + 1
    : 0;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5">
      <span className="text-sm font-semibold text-emerald-900">＋ New payment batch</span>
      <label className="flex items-center gap-1 text-xs text-emerald-800">
        Month
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded border border-emerald-300 bg-white px-2 py-1 text-xs text-slate-700"
        />
      </label>
      {valid ? (
        <span className="rounded bg-white px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-300">
          Disbursement #{disbNoFor(month)}.{proximoSub} · {monthName(month)}
        </span>
      ) : null}
      <label className="flex items-center gap-1 text-xs text-emerald-800">
        <input
          type="checkbox"
          checked={withRecurring}
          onChange={(e) => setWithRecurring(e.target.checked)}
        />
        with the 4 recurring lines
      </label>
      <button
        type="button"
        disabled={!valid || busy}
        onClick={submit}
        className="ml-auto rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? "Creating…" : `Create #${valid ? `${disbNoFor(month)}.${proximoSub}` : ""}`}
      </button>
      {taken ? (
        <span className="w-full text-xs text-amber-700">
          {monthName(month)} already has batch #{taken.disb_no}.{taken.disb_sub}. This one is
          created as{" "}
          <b>
            #{disbNoFor(month)}.{proximoSub}
          </b>{" "}
          — a month can have several (a directly-paid line apart from the Short Payment, for
          instance).
        </span>
      ) : null}
    </div>
  );
}

// Semáforo de un paso del cierre: ✓ hecho · ● en curso · ○ pendiente.
function Step({
  state,
  label,
  detail,
}: { state: "ok" | "warn" | "todo"; label: string; detail: string }) {
  const style =
    state === "ok"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : state === "warn"
        ? "bg-amber-50 text-amber-800 ring-amber-200"
        : "bg-slate-50 text-slate-500 ring-slate-200";
  const icon = state === "ok" ? "✓" : state === "warn" ? "●" : "○";
  return (
    <div className={`rounded-md px-2 py-1 text-xs ring-1 ${style}`} title={detail}>
      <span className="font-semibold">
        {icon} {label}
      </span>
      <span className="ml-1 opacity-80">{detail}</span>
    </div>
  );
}

// "Correr el mes": encadena Ledger → Job Cost → cruce de facturas y cuenta qué pasó.
function RunMonthButton({ disbNo, lines }: { disbNo: number; lines: number }) {
  const run = useRunMonth();
  return (
    <button
      type="button"
      disabled={lines === 0 || run.isPending}
      title="Bring it into the Ledger, deploy it to the Job Cost and match the invoices — in one go. Safe to repeat."
      onClick={() => {
        if (
          !window.confirm(
            `Run the month for #${disbNo}?\n\n1. Short Payment → Ledger (keeps cost codes, amounts paid and invoices)\n2. Ledger → Job Cost schedule\n3. Match invoices and apply the safe ones\n\nYou can run it again as many times as you need.`,
          )
        )
          return;
        run.mutate(disbNo, {
          onSuccess: (r) => {
            const jc = r.jobcost.conflicts?.length
              ? `⚠ Job Cost: nothing placed — ${r.jobcost.conflicts.map((c) => c.wbs_code).join(", ")} already have an amount that month`
              : `Job Cost: ${r.jobcost.placed} project #s placed${r.jobcost.week ? ` (week of ${r.jobcost.week})` : ""}`;
            alert(
              `Month #${r.disb_no}\n\n` +
                `Ledger: ${r.ledger.imported} new · ${r.ledger.updated} refreshed${r.ledger.removed ? ` · ${r.ledger.removed} removed` : ""}\n` +
                `${r.missing_cost_codes ? `⚠ ${r.missing_cost_codes} line(s) still without a project # — assign them and run again\n` : ""}` +
                `${jc}\n` +
                `Invoices: ${r.invoices.applied} applied automatically · ${r.invoices.review} left to review`,
            );
          },
          onError: (err) =>
            alert(
              err instanceof ApiError
                ? (err.problem.detail ?? err.problem.title)
                : "Could not run the month.",
            ),
        });
      }}
      className="rounded bg-[#151916] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#2F956E] disabled:opacity-40"
    >
      {run.isPending ? "Running…" : "▶ Run the month"}
    </button>
  );
}

// Cierre del mes: en qué va cada tanda (del #26 en adelante).
function MonthClose() {
  const cycle = useCycleStatus(26);
  const rows = cycle.data ?? [];
  // Owner, 2026-11-10: *«puedes darme la opcion de esconder o visulizar con
  // click esto»*. Es el bloque más alto de la pantalla y el que menos mira
  // quien solo viene a ver una tanda.
  //
  // ⚠️ Se recuerda en el navegador: si hubiera que volver a cerrarlo en cada
  // visita, la opción no serviría de nada. Va en try/catch porque en una
  // ventana privada `localStorage` tira excepción al leerlo.
  //
  // ⚠️ Y se lee en un `useEffect`, no al pintar: leerlo durante el render hace
  // que el servidor arme una cosa y el navegador otra, y React tira el árbol
  // entero. El precio es que, si estaba cerrado, se ve un parpadeo al cargar.
  const [abierto, setAbierto] = useState(true);
  useEffect(() => {
    try {
      setAbierto(localStorage.getItem("mes-cierre-cerrado") !== "1");
    } catch {
      /* sin localStorage: queda abierto, que es el default */
    }
  }, []);
  const alternar = () => {
    setAbierto((v) => {
      try {
        localStorage.setItem("mes-cierre-cerrado", v ? "1" : "0");
      } catch {
        /* no poder recordarlo no debe impedir abrirlo o cerrarlo */
      }
      return !v;
    });
  };

  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={alternar}
        aria-expanded={abierto}
        className="flex w-full items-center gap-2 rounded-t-lg px-4 py-2 text-left transition hover:bg-slate-50"
      >
        <span className={`text-slate-400 transition-transform ${abierto ? "rotate-90" : ""}`}>
          ▶
        </span>
        <span className="text-sm font-semibold text-slate-800">Month close</span>
        <span className="text-xs text-slate-400">
          where each batch stands · from #26 onward (earlier months are already validated)
        </span>
        {/* Cerrado, el encabezado tiene que decir qué se está escondiendo. */}
        <span className="ml-auto text-xs text-slate-400">
          {abierto ? "hide" : `show · ${rows.length} batches`}
        </span>
      </button>
      <div
        className={`divide-y divide-slate-100 border-t border-slate-200 ${abierto ? "" : "hidden"}`}
      >
        {rows.map((r) => {
          const sent = r.status !== "draft";
          const inLedger = r.ledger_rows > 0;
          const codesOk = inLedger && r.ledger_no_code === 0;
          const deployed = r.jobcost_codes > 0 && r.jobcost_placed >= r.jobcost_codes;
          return (
            <div
              key={`${r.disb_no}.${r.disb_sub}`}
              className="flex flex-wrap items-center gap-2 px-4 py-2"
            >
              <span className="w-40 shrink-0 text-xs">
                <b className="text-slate-800">
                  #{r.disb_no}.{r.disb_sub}
                </b>{" "}
                <span className="text-slate-500">
                  {new Date(`${r.period_month}T00:00:00`).toLocaleDateString("en", {
                    month: "short",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                </span>
                <span className="block tabular text-xs text-slate-400">{usd2(r.total_amount)}</span>
              </span>
              <Step state={r.lines > 0 ? "ok" : "todo"} label="Lines" detail={`${r.lines}`} />
              <Step
                state={sent ? "ok" : "todo"}
                label="Sent"
                detail={STATUS_LABEL[r.status] ?? r.status}
              />
              <Step
                state={inLedger ? "ok" : "todo"}
                label="Ledger"
                detail={inLedger ? `${r.ledger_rows} rows` : "not brought in yet"}
              />
              <Step
                state={!inLedger ? "todo" : codesOk ? "ok" : "warn"}
                label="Cost codes"
                detail={inLedger ? `${r.ledger_no_code} missing` : "—"}
              />
              <Step
                state={!inLedger ? "todo" : deployed ? "ok" : "warn"}
                label="Job Cost"
                detail={inLedger ? `${r.jobcost_placed}/${r.jobcost_codes} project #s` : "—"}
              />
              <Step
                state={r.invoiced_rows > 0 ? (r.invoices_pending === 0 ? "ok" : "warn") : "todo"}
                label="Invoices"
                detail={`${r.invoiced_rows} applied · ${r.invoices_pending} pending that month`}
              />
              <span className="ml-auto">
                <RunMonthButton disbNo={r.disb_no} lines={r.lines} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ShortPaymentsView() {
  const q = useShortPayments();
  const me = useMe();
  const payees = usePayees().data ?? [];
  const wbsList = (useWbsList().data ?? []).filter((w) => w.kind !== "section_header");
  const categories = useCategories().data ?? [];
  const phases = usePhases().data ?? [];
  const canEdit = me.data?.permissions.includes("disb.create") ?? false;
  const canSubmit = me.data?.permissions.includes("disb.submit") ?? false;
  const canApprove = me.data?.permissions.includes("disb.approve") ?? false;
  const reopen = useReopenDisbursement();
  const qc = useQueryClient();
  const [uploadingId, setUploadingId] = useState<number | null>(null);

  // Subir Excel: reemplaza las líneas de esa tanda (borrador) con las del archivo.
  async function uploadExcel(id: number, f: File) {
    setUploadingId(id);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(`/api/disbursements/${id}/lines/import`, {
        method: "POST",
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(j.detail || "Could not import the Excel file.");
        return;
      }
      qc.invalidateQueries({ queryKey: ["short-payments"] });
      qc.invalidateQueries({ queryKey: ["disbursements"] });
      alert(`Done: ${j.imported} lines imported from Excel.`);
    } finally {
      setUploadingId(null);
    }
  }

  if (q.isLoading) return <p className="text-sm text-slate-500">Loading payments…</p>;
  const batches = q.data ?? [];
  const showBank = batches.some((b) => b.lines.some((l) => l.bank_name));
  // #, WBS, Descripción, Factura #, Nota, Categoría/Tipo, Nombre, Transfer (+ banco)
  const preCols = 8 + (showBank ? 1 : 0);

  if (batches.length === 0)
    return (
      <div className="space-y-4">
        {canEdit ? <NewBatchBar batches={batches} /> : null}
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No payment batches yet. Create the month's batch above (or import it from Excel in the
          Disbursements tab).
        </p>
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Catálogo de proveedores para el campo Nombre */}
      <datalist id="payee-names">
        {payees.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      {/* Catálogo de proyectos para la columna WBS */}
      <datalist id="wbs-codes">
        {wbsList.map((w) => (
          <option key={w.id} value={w.wbs_code}>
            {w.title}
          </option>
        ))}
      </datalist>

      <MonthClose />
      {canEdit ? <NewBatchBar batches={batches} /> : null}

      {batches.map((b) => {
        const editable = canEdit && b.status === "draft";
        // Corregir algo ya enviado/aprobado: vuelve a borrador (des-enviar).
        const canReopen =
          (b.status === "submitted" && canSubmit) || (b.status === "approved" && canApprove);
        return (
          <div key={b.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            {/* ⚠️ Cabecera CLARA. Era una barra negra y es lo que mas desentonaba
                contra la vista de Disbursements, que es la que el owner aprobo
                («aca se bien», 2026-11-10). El titulo manda, el estado va en un
                chip y el total en grande a la derecha. */}
            <div className={CABECERA}>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-800">
                    To be sent {batchTitle(b)}
                  </h2>
                  <span className={chipEstado(b.status)}>{rotuloEstado(b.status)}</span>
                </div>
                <p className="text-xs text-slate-500">
                  Disbursement <BatchNo b={b} editable={canEdit} /> · {b.lines.length} line
                  {b.lines.length === 1 ? "" : "s"}
                  {editable ? " · editable" : ""} ·{" "}
                  <span className="tabular font-semibold text-slate-700">
                    {usd2(b.total_amount)}
                  </span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void api.abrir(`/disbursements/${b.id}/lines.xlsx`, true)}
                  className={BTN_EXCEL}
                  title="Download the lines to Excel to edit them"
                >
                  ⬇ Excel
                </button>
                {canReopen ? (
                  <button
                    type="button"
                    disabled={reopen.isPending}
                    title="Bring it back to draft to correct it (clears the approvals)"
                    className={`${BTN_REABRIR} disabled:opacity-50`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Reopen #${b.disb_no}.${b.disb_sub} as a draft to correct it?\nThe approvals recorded so far are cleared and it has to be submitted again.`,
                        )
                      )
                        reopen.mutate({ id: b.id });
                    }}
                  >
                    {reopen.isPending ? "Reopening…" : "↩ Reopen"}
                  </button>
                ) : null}
                {editable ? (
                  <label
                    className={`${BTN_EXCEL} cursor-pointer ${uploadingId === b.id ? "opacity-50" : ""}`}
                    title="Upload the edited Excel (replaces the lines)"
                  >
                    {uploadingId === b.id ? "Uploading…" : "⬆ Upload Excel"}
                    <input
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      disabled={uploadingId === b.id}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadExcel(b.id, f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                ) : null}
              </div>
            </div>
            <div className={`${TABLA} m-3 border-0`}>
              <table className="w-full min-w-[1000px] text-sm">
                <thead className={THEAD}>
                  <tr>
                    <th className={TH}>#</th>
                    <th className={TH}>Project</th>
                    <th className={TH}>Description</th>
                    <th className={TH}>Invoice #</th>
                    <th className={TH}>Note</th>
                    <th className={TH}>Category / Type</th>
                    <th className={TH}>Name</th>
                    <th className={`${TH} text-center`}>Transfer</th>
                    {showBank ? <th className={TH}>Bank</th> : null}
                    <th className={`${TH} text-right`}>Amount</th>
                    {editable ? <th className={TH} /> : null}
                  </tr>
                </thead>
                <LinesBody
                  batch={b}
                  editable={editable}
                  showBank={showBank}
                  payees={payees}
                  categories={categories}
                  phases={phases}
                  wbsList={wbsList}
                  preCols={preCols}
                />
                <tfoot className={TFOOT}>
                  <tr>
                    <td className="px-2 py-2 text-right" colSpan={preCols}>
                      TOTAL
                    </td>
                    <td className="tabular px-2 py-2 text-right">{usd2(b.total_amount)}</td>
                    {editable ? <td /> : null}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
