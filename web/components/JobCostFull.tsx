"use client";

import { PrintBar } from "@/components/PrintBar";
import { BotonMasterFile } from "@/components/BotonMasterFile";
import type { ApiError } from "@/lib/api";
import { evalMath } from "@/lib/calc";
import { COL_HELP, ColHead } from "@/lib/colhelp";
import { num } from "@/lib/format";
import {
  useApplyLedgerHistory,
  useCategories,
  useCreateWbs,
  useCutoff,
  useEditWbsMeta,
  useFinancials,
  useLedgerHistoryPreview,
  useMe,
  usePhases,
  useProjectMeta,
  useReassign,
  useScheduleCells,
  useScheduleWeeks,
  useSetCutoff,
  useSetForecast,
  useTaskStates,
  useUpdateWbsDates,
  useUpdateWbsField,
  useUpsertCells,
  useWbsList,
} from "@/lib/hooks";
import { PaintToolbar, softenHex, usePaintTool } from "@/lib/paint";
import { type View, buildColumns, columnTotal, indexCells, yearsOf } from "@/lib/schedule";
import type { Category, Phase, TaskState, Wbs, WbsFinancials } from "@/lib/types";
import { useQueryClient } from "@tanstack/react-query";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const STATE_COLOR: Record<string, string> = {
  not_started: "#CCCCCC",
  in_process: "#EAB308",
  approved: "#1155CC",
  attention: "#B85B22",
  completed: "#38761D",
};

interface Tot {
  orig: number;
  chg: number;
  rev: number;
  spend: number;
  rem: number;
  fc: number;
  ou: number;
  tl: number;
  act: number; // timeline ANTES del corte (actual ejecutado)
  fcst: number; // timeline DESDE el corte (forecast / plan)
}
const Z = (): Tot => ({
  orig: 0,
  chg: 0,
  rev: 0,
  spend: 0,
  rem: 0,
  fc: 0,
  ou: 0,
  tl: 0,
  act: 0,
  fcst: 0,
});

type Row =
  | { kind: "sec"; sec: string; title: string }
  | { kind: "line"; r: WbsFinancials; tl: number }
  | { kind: "total"; sec: string; t: Tot };

// Sección WBS = primer segmento numérico del código (0..9). '3.101' → '3'.
function sectionOf(code: string): string {
  const seg = code.split(".")[0];
  return /^\d+$/.test(seg) ? String(Number(seg)) : "—";
}

// Texto en dólares (tooltips / strip). Negativos entre paréntesis.
const usd = (n: number): string => {
  const t = `$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
  return n < 0 ? `(${t})` : t;
};
// Monto completo con $ y 2 decimales (hover).
const full2 = (n: number): string => {
  const t = `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `(${t})` : t;
};
// Celda de dinero: signo $ y negativos en rojo.
function m(n: number): ReactNode {
  if (n === 0) return <span className="text-slate-400">—</span>;
  return <span className={n < 0 ? "text-red-600" : undefined}>{usd(n)}</span>;
}
// Timeline compacto: $ + K/M en MAYÚSCULA y negrita; negativos en rojo.
function compactNode(n: number): ReactNode {
  if (!n) return "";
  const a = Math.abs(n);
  const neg = n < 0;
  let body: ReactNode;
  if (a >= 1_000_000)
    body = (
      <>
        {(a / 1_000_000).toFixed(2)}
        <b>M</b>
      </>
    );
  else if (a >= 1000)
    body = (
      <>
        {(a / 1000).toFixed(2)}
        <b>K</b>
      </>
    );
  else body = String(Math.round(a));
  return (
    <span className={neg ? "text-red-600" : undefined}>
      {neg ? "($" : "$"}
      {body}
      {neg ? ")" : ""}
    </span>
  );
}

// % Complete → color de fondo. Escala roja (0%) → amarilla (~50%) → verde (100%+).
function pctColor(pct: number): string {
  const p = Math.max(0, Math.min(100, pct)) / 100;
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  const [r, g, b] =
    p < 0.5
      ? [lerp(214, 234, p / 0.5), lerp(69, 179, p / 0.5), lerp(69, 8, p / 0.5)]
      : [
          lerp(234, 56, (p - 0.5) / 0.5),
          lerp(179, 118, (p - 0.5) / 0.5),
          lerp(8, 29, (p - 0.5) / 0.5),
        ];
  return `rgb(${r}, ${g}, ${b})`;
}

// Celda "% Complete" = spend / revised. Fondo con la escala de color y texto legible.
function PctCell({
  spend,
  rev,
  foot,
  stickCls,
  stickStyle,
}: {
  spend: number;
  rev: number;
  foot?: boolean;
  stickCls?: string;
  stickStyle?: CSSProperties;
}) {
  const has = rev > 0;
  const pct = has ? (spend / rev) * 100 : 0;
  const bg = pctColor(pct);
  const nums = bg.match(/\d+/g) ?? ["0", "0", "0"];
  const lum = 0.299 * Number(nums[0]) + 0.587 * Number(nums[1]) + 0.114 * Number(nums[2]);
  const fg = lum > 150 ? "#1e293b" : "#ffffff";
  return (
    <td
      className={`tabular text-right font-medium ${foot ? "px-2 py-2" : "px-2"} ${stickCls ?? ""}`}
      style={{ backgroundColor: has ? bg : "#ffffff", color: has ? fg : undefined, ...stickStyle }}
      title={has ? `${pct.toFixed(2)}% executed (${usd(spend)} of ${usd(rev)})` : "No budget"}
    >
      {has ? `${pct.toFixed(2)}%` : <span className="text-slate-400">—</span>}
    </td>
  );
}

// Validación por línea: ¿necesita ajuste? nivel 0=ok, 1=aviso, 2=problema.
function lineIssues(r: WbsFinancials, tl: number): { level: number; msgs: string[] } {
  const rev = num(r.budget_revised);
  const spend = num(r.spend);
  const ou = num(r.over_under);
  const rem = num(r.remaining);
  const msgs: string[] = [];
  let level = 0;
  // Tolerancia de $1: ignora el ruido de centavos del redondeo al distribuir.
  if (rem < -1) {
    msgs.push(`Overdrawn: spend ${usd(spend)} exceeds budget ${usd(rev)}`);
    level = 2;
  }
  if (ou > 1) {
    msgs.push(`Forecast ${usd(num(r.forecast))} above revised ${usd(rev)} (over ${usd(ou)})`);
    level = Math.max(level, 2);
  }
  if (rev > 0) {
    const gap = rev - tl;
    if (tl === 0) {
      msgs.push(`Not distributed in the schedule (${usd(rev)})`);
      level = Math.max(level, 1);
    } else if (Math.abs(gap) > Math.max(100, rev * 0.02)) {
      msgs.push(
        `Schedule differs from budget: ${usd(Math.abs(gap))} ${gap > 0 ? "undistributed" : "over"}`,
      );
      level = Math.max(level, 1);
    }
  }
  return { level, msgs };
}

function ForecastCell({
  r,
  canEdit,
  onSave,
}: {
  r: WbsFinancials;
  canEdit: boolean;
  onSave: (v: { id: number; forecast_total: number | null }) => void;
}) {
  const fc = num(r.forecast);
  if (!canEdit) return <>{m(fc)}</>;
  // Muestra formateado con $ (como REVISED/SPEND); al enfocar, el número plano
  // para editar; al salir, guarda y vuelve a formatear.
  return (
    <input
      key={fc}
      type="text"
      inputMode="decimal"
      className="tabular w-full rounded border border-transparent bg-transparent px-1 text-right hover:border-slate-300 focus:border-slate-400 focus:bg-white"
      defaultValue={usd(fc)}
      onFocus={(e) => {
        e.currentTarget.value = fc ? String(fc) : "";
        e.currentTarget.select();
      }}
      onBlur={(e) => {
        const raw = e.currentTarget.value.replace(/[^0-9.-]/g, "");
        const next = raw === "" ? null : Number(raw);
        if (String(next) !== String(fc)) onSave({ id: r.id, forecast_total: next });
        e.currentTarget.value = next == null ? "" : usd(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = usd(fc);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// Celda numérica SIEMPRE editable (Original/Changes/Spend) — estilo Excel: se ve como
// número alineado a la derecha pero es un input; guarda al salir o con Enter.
function EditableNumCell({
  value,
  canEdit,
  onSave,
  className,
}: {
  value: number;
  canEdit: boolean;
  onSave: (v: number | null) => void;
  className?: string;
}) {
  if (!canEdit) return <span className="tabular px-2">{m(value)}</span>;
  // Muestra formateado con $ ($388,000); al enfocar, el número plano para editar;
  // al salir, guarda y re-formatea.
  return (
    <input
      key={value}
      type="text"
      inputMode="decimal"
      className={`tabular w-full rounded border border-transparent bg-transparent px-1 text-right hover:border-slate-300 focus:border-slate-400 focus:bg-white ${className ?? ""}`}
      defaultValue={usd(value)}
      onFocus={(e) => {
        e.currentTarget.value = value ? String(value) : "";
        e.currentTarget.select();
      }}
      onBlur={(e) => {
        const raw = e.currentTarget.value.replace(/[^0-9.-]/g, "");
        const next = raw === "" ? null : Number(raw);
        if (String(next) !== String(value)) onSave(next);
        e.currentTarget.value = next == null ? "" : usd(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = usd(value);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// Celda de fecha editable (Start/Due). El backend recomputa Duration = DAYS360.
function EditableDateCell({
  value,
  canEdit,
  onSave,
}: {
  value: string | null;
  canEdit: boolean;
  onSave: (v: string | null) => void;
}) {
  if (!canEdit) return <span className="px-1 text-xs text-slate-500">{value ?? "—"}</span>;
  return (
    <input
      type="date"
      className="w-[96px] rounded border border-slate-200 bg-transparent px-0.5 text-xs hover:border-slate-400"
      value={value ?? ""}
      onChange={(e) => onSave(e.target.value === "" ? null : e.target.value)}
    />
  );
}

// Celda de texto SIEMPRE editable (Task Title / Owner) — estilo Excel: se ve como
// texto pero es un input; guarda al salir (onBlur) o con Enter. Sin toggle de "modo
// edición" (ese patrón se reseteaba con los re-render de la grilla viva).
// allowEmpty=false ⇒ un valor vacío se descarta (el título no puede quedar en blanco).
// `key={value}` re-siembra el input cuando el valor cambia por otra edición.
function EditableTextCell({
  value,
  canEdit,
  onSave,
  allowEmpty = false,
  placeholder,
}: {
  value: string;
  canEdit: boolean;
  onSave: (v: string) => void;
  allowEmpty?: boolean;
  placeholder?: string;
}) {
  if (!canEdit)
    return (
      <span className="truncate">{value ? value : <span className="text-slate-300">—</span>}</span>
    );
  return (
    <input
      key={value}
      type="text"
      className="w-full truncate rounded border border-transparent bg-transparent px-1 hover:border-slate-300 focus:border-slate-400 focus:bg-white"
      defaultValue={value}
      placeholder={placeholder}
      onBlur={(e) => {
        const t = e.target.value.trim();
        if (t !== value && (allowEmpty || t !== "")) onSave(t);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = value;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

// Select inline (Category / Phase). nullable ⇒ ofrece la opción vacía "—".
function SelectCell({
  value,
  options,
  canEdit,
  onChange,
  disabled,
  placeholder = "—",
  nullable = true,
}: {
  value: number | null;
  options: { id: number; label: string }[];
  canEdit: boolean;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  nullable?: boolean;
}) {
  if (!canEdit) {
    const cur = options.find((o) => o.id === value);
    return <span className="text-slate-500">{cur?.label ?? "—"}</span>;
  }
  return (
    <select
      className="w-full rounded border border-slate-200 bg-transparent px-0.5 py-0.5 text-xs hover:border-slate-400 disabled:opacity-40"
      value={value === null ? "" : String(value)}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    >
      {nullable ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// Estado (task_state) en la columna "St": el punto de color es el indicador; al
// hacer clic (con permiso) se cambia con un select que abre sobre las columnas.
function StateCell({
  stateId,
  states,
  canEdit,
  onSave,
  issue,
}: {
  stateId: number | undefined;
  states: TaskState[];
  canEdit: boolean;
  onSave: (v: number) => void;
  issue: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const st = states.find((s) => s.id === stateId);
  const dot = (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: st ? (STATE_COLOR[st.code] ?? st.color_hex) : "#99A49D" }}
      title={st?.label ?? ""}
    />
  );
  if (editing)
    return (
      <select
        // biome-ignore lint/a11y/noAutofocus: edición al hacer clic
        autoFocus
        className="relative z-30 w-24 rounded border border-slate-400 bg-white text-xs"
        value={stateId ?? ""}
        onChange={(e) => {
          onSave(Number(e.target.value));
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
      >
        {states.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    );
  return (
    <span className="flex items-center justify-center gap-0.5">
      {canEdit ? (
        <button
          type="button"
          className="rounded hover:ring-1 hover:ring-slate-400"
          title="Change status"
          onClick={() => setEditing(true)}
        >
          {dot}
        </button>
      ) : (
        dot
      )}
      {issue}
    </span>
  );
}

// Formulario para agregar una nueva línea WBS desde Job Cost (POST /wbs).
function AddWbsForm({
  categories,
  phases,
  onDone,
}: {
  categories: Category[];
  phases: Phase[];
  onDone: () => void;
}) {
  const create = useCreateWbs();
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [catId, setCatId] = useState<number | null>(null);
  const [phaseId, setPhaseId] = useState<number | null>(null);
  const [budget, setBudget] = useState("");
  const phaseOpts = phases
    .filter((p) => catId !== null && p.category_id === catId)
    .map((p) => ({ id: p.id, label: p.name }));
  const err = create.error ? (create.error as ApiError).problem : null;
  const submit = async () => {
    if (!code.trim() || !title.trim()) return;
    await create.mutateAsync({
      wbs_code: code.trim(),
      title: title.trim(),
      owner: owner.trim() === "" ? null : owner.trim(),
      category_id: catId,
      phase_id: catId !== null ? phaseId : null,
      budget_original_ovr: budget === "" ? null : Number(budget),
    });
    onDone();
  };
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-sm">
      <span className="font-medium text-emerald-800">New WBS line</span>
      <input
        className="w-28 rounded border border-slate-300 px-2 py-1"
        placeholder="Code *"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <input
        className="w-52 rounded border border-slate-300 px-2 py-1"
        placeholder="Title *"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className="w-32 rounded border border-slate-300 px-2 py-1"
        placeholder="Owner"
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
      />
      <select
        className="rounded border border-slate-300 px-2 py-1"
        value={catId === null ? "" : String(catId)}
        onChange={(e) => {
          setCatId(e.target.value === "" ? null : Number(e.target.value));
          setPhaseId(null);
        }}
      >
        <option value="">Category…</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select
        className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
        value={phaseId === null ? "" : String(phaseId)}
        disabled={catId === null}
        onChange={(e) => setPhaseId(e.target.value === "" ? null : Number(e.target.value))}
      >
        <option value="">Phase…</option>
        {phaseOpts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <input
        type="number"
        className="w-32 rounded border border-slate-300 px-2 py-1 text-right"
        placeholder="Orig. Budget"
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
      />
      <button
        type="button"
        className="rounded bg-emerald-700 px-3 py-1 text-white disabled:opacity-50"
        disabled={create.isPending || !code.trim() || !title.trim()}
        onClick={submit}
      >
        Add
      </button>
      <button type="button" className="text-slate-500" onClick={onDone}>
        Cancel
      </button>
      {err ? <span className="text-red-600">{err.detail ?? err.title}</span> : null}
    </div>
  );
}

const MONEYTH = "px-2 py-2 text-right text-xs font-semibold uppercase whitespace-nowrap";
// Cada <th> de la cabecera se pega por su cuenta: un <thead> sticky NO sirve si
// alguna celda ya es sticky (la celda abre su propio contexto y se va al bajar).
const THH = "sticky top-0 z-30 bg-[#151916]";

// Bloque CONGELADO: St … Over/Under (17 columnas). Al scrollear el cronograma,
// estas quedan fijas para ver el presupuesto mientras se asignan recursos.
// índices: 0 St · 1 WBS · 2 Task Title · 3 Owner · 4 Category · 5 Phase · 6 Start ·
//          7 Due · 8 Dur · 9 Orig · 10 Changes · 11 Revised · 12 Spend · 13 Remaining ·
//          14 %Compl · 15 Forecast · 16 Over/Under
// Bloque CONGELADO reordenado: St · WBS · Task Title · Orig · Changes · Revised ·
// Spend · Remaining · %Compl · Forecast · Over/Under (los detalles Owner/Category/
// Phase/Start/Due/Dur se mueven a la derecha para no estorbar al asignar).
const LCW = [30, 58, 190, 114, 104, 114, 104, 114, 66, 114, 114];
const LCX: number[] = LCW.reduce<number[]>((a, _w, i) => {
  a.push(i === 0 ? 0 : a[i - 1] + LCW[i - 1]);
  return a;
}, []);
const FROZEN_W = LCX[LCW.length - 1] + LCW[LCW.length - 1];
// clase + estilo de una columna congelada. z: "z-20" body, "z-30" cabecera.
// Ancho FORZADO (min=max=width, box-sizing) para que el real coincida con el
// offset sticky y no haya deriva al scrollear.
const fcls = (bg: string, z = "z-20") => `sticky ${z} ${bg} overflow-hidden`;
// Cabecera congelada: pegajosa en los DOS ejes. Un <th> sticky abre su propio
// contexto, asi que el `sticky top-0` del <thead> no le llega: sin `top` propio
// la mitad izquierda del encabezado se perdia al bajar.
const fhead = (bg: string) => `${fcls(bg, "z-40")} top-0`;
const fst = (i: number): CSSProperties => ({
  left: LCX[i],
  width: LCW[i],
  minWidth: LCW[i],
  maxWidth: LCW[i],
  boxSizing: "border-box",
});

/** Una celda del cronograma escrita y todavia sin guardar.
 *  `planned_amount: null` = pendiente de BORRADO. */
type PendCell = {
  wbs_id: number;
  week_start: string;
  planned_amount: number | null;
  state_id?: number;
};

export function JobCostFull() {
  const qc = useQueryClient();
  const me = useMe();
  const financials = useFinancials();
  const weeks = useScheduleWeeks();
  const cells = useScheduleCells();
  const states = useTaskStates();
  const meta = useProjectMeta();
  const setFc = useSetForecast();
  const upd = useUpdateWbsField();
  const updDates = useUpdateWbsDates();
  const editMeta = useEditWbsMeta();
  const reassign = useReassign();
  const categories = useCategories();
  const phases = usePhases();
  const wbsList = useWbsList();
  const cutoff = useCutoff();
  const setCutoff = useSetCutoff();
  const scroller = useRef<HTMLDivElement>(null);
  // ⚠️ Ademas del ref, el nodo en estado. Los efectos de abajo -la rueda y el
  // observador de visibilidad- se enganchan AL NODO, y con `[]` corrian una
  // sola vez al montar: en ese momento el componente todavia devuelve
  // "Loading Job Cost…" y la grilla no existe, asi que scroller.current era
  // null y se enganchaban a nada. Nunca volvian a correr. Con el nodo en
  // estado, los efectos se rehacen cuando la grilla aparece de verdad.
  const [nodoGrilla, setNodoGrilla] = useState<HTMLDivElement | null>(null);
  const fijarGrilla = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el;
    setNodoGrilla(el);
  }, []);

  const [view, setView] = useState<View>("month");
  // Años seleccionados (multi-selección: se pueden ver 2+ años juntos, útil para
  // mover semanas de un año a otro). null = por defecto (año actual).
  const [selYears, setSelYears] = useState<number[] | null>(null);
  const [sel, setSel] = useState<{ wbsId: number; week: string } | null>(null);
  // ── Bloque: un rectangulo de celdas, para moverlo entero ────────────────
  //
  // ⚠️ Antes solo se podia arrastrar UNA celda a otra semana. Correr un mes de
  // cinco lineas eran veinte arrastres, y el owner lo dijo con todas las
  // letras: "se hace muy tedioso".
  //
  // Se guarda por INDICES de fila y columna (no por wbs_id y fecha) porque el
  // movimiento es "correr N columnas": con indices es una resta, y con fechas
  // habria que recalcular que semana cae N lugares mas alla cada vez.
  const [bloque, setBloque] = useState<{ f0: number; f1: number; c0: number; c1: number } | null>(
    null,
  );
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [adding, setAdding] = useState(false);
  // Arrastrar un monto de un mes/semana a otro (misma línea). null = sin arrastre.
  const [dragSrc, setDragSrc] = useState<{ wbsId: number; key: string; weeks: string[] } | null>(
    null,
  );
  const upsertCells = useUpsertCells();
  // Buffer de edición inline de la celda del cronograma (tipo Excel). null = no editando.
  const [editBuf, setEditBuf] = useState<string | null>(null);
  // Filtro rápido por N° de proyecto (Cost Code) / título — para revisar rápido.
  const [projFilter, setProjFilter] = useState("");

  // Mueve el monto de una columna (mes/semana) a otra dentro de la MISMA línea:
  // suma lo de las semanas origen, lo limpia, y lo coloca en una semana del destino
  // (sumando si el destino ya tenía algo). Conserva el estado/color de origen.
  async function moveColumn(
    wbsId: number,
    fromWeeks: string[],
    toWeeks: string[],
    rowIdx: Map<string, { amount: number | null; state_id: number }> | undefined,
  ) {
    if (!rowIdx || toWeeks.length === 0) return;
    let total = 0;
    let carryState: number | null = null;
    const toClear: string[] = [];
    for (const w of fromWeeks) {
      const cell = rowIdx.get(w);
      if (!cell) continue;
      if (cell.amount) {
        total += cell.amount;
        if (carryState === null) carryState = cell.state_id;
      }
      toClear.push(w);
    }
    if (Math.abs(total) < 0.0001) return;
    // Semana ancla del destino: la que ya tenga monto, o la 3ª del período (como el
    // despliegue del Ledger), o la primera.
    const targetWeek =
      toWeeks.find((w) => Math.abs(rowIdx.get(w)?.amount ?? 0) > 0.0001) ??
      toWeeks[Math.min(2, toWeeks.length - 1)] ??
      toWeeks[0];
    const existing = rowIdx.get(targetWeek);
    const newAmount = (existing?.amount ?? 0) + total;
    const newState = existing?.state_id ?? carryState ?? states.data?.[0]?.id ?? 1;
    anotar([
      ...toClear.map((w) => ({ wbs_id: wbsId, week_start: w, planned_amount: null })),
      {
        wbs_id: wbsId,
        week_start: targetWeek,
        planned_amount: newAmount,
        state_id: newState,
      },
    ]);
  }

  // Ids actuales (category/phase/state) por línea — la vista financials sólo trae
  // nombres, pero los editores inline necesitan los ids para PUT/PATCH.
  const metaById = useMemo(
    () => new Map<number, Wbs>((wbsList.data ?? []).map((w) => [w.id, w])),
    [wbsList.data],
  );
  const catOpts = useMemo(
    () => (categories.data ?? []).map((c) => ({ id: c.id, label: c.name })),
    [categories.data],
  );

  const canEdit = me.data?.permissions.includes("wbs.edit") ?? false;
  // Traer historial del LEDGER: la vista previa se pide solo al abrir el modal.
  const [histOpen, setHistOpen] = useState(false);
  const hist = useLedgerHistoryPreview(histOpen);
  const histApply = useApplyLedgerHistory();
  const canSched = me.data?.permissions.includes("schedule.edit") ?? false;
  const paint = usePaintTool();
  const weekList = weeks.data?.weeks ?? []; // TODAS las semanas (Timeline Total / Control usan esto)
  // Actual = timeline ANTES del corte; Forecast = timeline DESDE el corte. Se
  // re-parten solos al cambiar el Forecast Cut-off Date.
  const cutoffDate = cutoff.data?.cutoff_date ?? "";
  const pastWeeks = useMemo(
    () => (cutoffDate ? weekList.filter((w) => w < cutoffDate) : weekList),
    [weekList, cutoffDate],
  );
  const futureWeeks = useMemo(
    () => (cutoffDate ? weekList.filter((w) => w >= cutoffDate) : []),
    [weekList, cutoffDate],
  );
  const years = useMemo(() => yearsOf(weekList), [weekList]);
  const defaultYear = years.includes(2026) ? 2026 : (years[0] ?? 2026);
  // Años activos (multi-selección). Vacío/null → el año por defecto.
  const activeYears = useMemo(
    () => (selYears?.length ? selYears : [defaultYear]),
    [selYears, defaultYear],
  );
  // Marca/desmarca un año; nunca deja la selección vacía (vuelve al año por defecto).
  const toggleYear = (y: number) => {
    const cur = selYears?.length ? selYears : [defaultYear];
    const next = cur.includes(y) ? cur.filter((x) => x !== y) : [...cur, y].sort((a, b) => a - b);
    setSelYears(next.length ? next : [defaultYear]);
  };
  // Columnas del cronograma filtradas a los años seleccionados (1 o más).
  const viewWeeks = useMemo(
    () => weekList.filter((w) => activeYears.includes(Number(w.slice(0, 4)))),
    [weekList, activeYears],
  );
  const columns = useMemo(() => buildColumns(viewWeeks, view), [viewWeeks, view]);
  // Índice de la primera columna en/después del corte → línea roja gruesa (actuales | forecast).
  const cutIdx = useMemo(() => {
    const co = cutoff.data?.cutoff_date;
    if (!co) return -1;
    return columns.findIndex((c) => (c.weeks[0] ?? c.key) >= co);
  }, [columns, cutoff.data?.cutoff_date]);
  const cutBorder = (i: number) => (i === cutIdx ? " border-l-4 border-red-600" : "");
  // ── Ediciones sin guardar ────────────────────────────────────────────
  //
  // Antes cada celda se grababa sola al salir del campo. Funcionaba, pero el
  // guardado no era un acto de nadie: se escribia y pasaba algo, en silencio.
  // Y cuando NO pasaba —la sesion vencida del 2026-11-07— tampoco se notaba.
  //
  // Ahora lo que se escribe queda acá, a la vista y en ambar, hasta que se
  // aprieta Guardar. Entonces se manda TODO en un solo lote.
  //
  // El teclado no cambia: se sigue escribiendo, tabulando y pegando desde
  // Excel igual que siempre. Lo unico que cambia es cuando viaja.
  const [pend, setPend] = useState<Map<string, PendCell>>(() => new Map());

  const clave = (wbsId: number, week: string) => `${wbsId}|${week}`;

  const anotar = useCallback((nuevas: PendCell[]) => {
    if (!nuevas.length) return;
    setPend((prev) => {
      const m = new Map(prev);
      for (const c of nuevas) m.set(`${c.wbs_id}|${c.week_start}`, c);
      return m;
    });
  }, []);

  const indiceBase = useMemo(() => indexCells(cells.data ?? []), [cells.data]);

  // El indice que lee TODA la grilla: lo guardado, con lo pendiente encima.
  // Asi los totales de fila, de columna y el arrastre ven lo que se acaba de
  // escribir, sin tocar cada lugar que lee una celda.
  //
  // ⚠️ Esto se reconstruia ENTERO en cada edicion: un filter + un find por
  // cada pendiente sobre las ~19.600 celdas (78 lineas x 251 semanas) y
  // despues indexCells de nuevo sobre todas. Por eso la pagina se sentia
  // lenta. Ahora se clona el mapa de afuera y SOLO las filas tocadas: el
  // costo pasa a ser el de los pendientes, no el del cronograma entero.
  const index = useMemo(() => {
    if (pend.size === 0) return indiceBase;
    const porDefecto = states.data?.[0]?.id ?? 1;
    const m: typeof indiceBase = new Map(indiceBase);
    for (const c of pend.values()) {
      const fila = new Map(m.get(c.wbs_id) ?? []);
      if (c.planned_amount === null) {
        fila.delete(c.week_start);
      } else {
        fila.set(c.week_start, {
          amount: c.planned_amount,
          // Sin estado propio se conserva el que tenia; si es nueva, el primero.
          state_id: c.state_id ?? fila.get(c.week_start)?.state_id ?? porDefecto,
        });
      }
      m.set(c.wbs_id, fila);
    }
    return m;
  }, [indiceBase, pend, states.data]);

  // Título de cada sección numerada: sale de las filas section_header (o de la
  // fila con código entero, p.ej. '6' = Property Sale) — nunca se inventa.
  const secTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of financials.data ?? []) {
      if (/^\d+$/.test(r.wbs_code)) m.set(String(Number(r.wbs_code)), r.title);
    }
    return m;
  }, [financials.data]);

  const { rows, grand } = useMemo(() => {
    const q = projFilter.trim().toLowerCase();
    // La VENTA (proceeds) queda FUERA de todos los totales — va como línea de
    // referencia debajo del PROJECT TOTAL. Los gastos se mantienen.
    const lines = (financials.data ?? [])
      .filter((r) => r.kind !== "section_header" && r.kind !== "proceeds")
      .filter(
        (r) =>
          q === "" ||
          String(r.wbs_code).toLowerCase().includes(q) ||
          (r.title ?? "").toLowerCase().includes(q),
      );
    const map = new Map<string, WbsFinancials[]>();
    for (const r of lines) {
      const s = sectionOf(r.wbs_code);
      const arr = map.get(s);
      if (arr) arr.push(r);
      else map.set(s, [r]);
    }
    // Unión: secciones con líneas + secciones definidas por su encabezado (incluye
    // las vacías, ej. "10 Construction"). Con filtro activo NO agregamos las vacías.
    const secKeys = new Set<string>(q ? map.keys() : [...map.keys(), ...secTitles.keys()]);
    const secs = [...secKeys].sort((a, b) => {
      if (a === "—") return 1;
      if (b === "—") return -1;
      return Number(a) - Number(b);
    });
    const grand = Z();
    const rows: Row[] = [];
    for (const sec of secs) {
      const ls = map.get(sec) ?? [];
      const title = secTitles.get(sec) ?? (sec === "—" ? "Others" : `Section ${sec}`);
      rows.push({ kind: "sec", sec, title });
      const t = Z();
      for (const r of ls) {
        const act = columnTotal(index, r.id, pastWeeks);
        const fcst = columnTotal(index, r.id, futureWeeks);
        const tl = act + fcst;
        rows.push({ kind: "line", r, tl });
        t.orig += num(r.budget_original);
        t.chg += num(r.budget_change);
        t.rev += num(r.budget_revised);
        t.spend += num(r.spend);
        t.rem += num(r.remaining);
        t.fc += num(r.forecast);
        t.ou += num(r.over_under);
        t.tl += tl;
        t.act += act;
        t.fcst += fcst;
      }
      rows.push({ kind: "total", sec, t });
      grand.orig += t.orig;
      grand.chg += t.chg;
      grand.rev += t.rev;
      grand.spend += t.spend;
      grand.rem += t.rem;
      grand.fc += t.fc;
      grand.ou += t.ou;
      grand.tl += t.tl;
      grand.act += t.act;
      grand.fcst += t.fcst;
    }
    return { rows, grand };
  }, [financials.data, index, pastWeeks, futureWeeks, secTitles, projFilter]);

  const linesOf = (sec: string) =>
    rows
      .filter(
        (x): x is { kind: "line"; r: WbsFinancials; tl: number } =>
          x.kind === "line" && sectionOf(x.r.wbs_code) === sec,
      )
      .map((x) => x.r);
  const allLines = rows
    .filter((x): x is { kind: "line"; r: WbsFinancials; tl: number } => x.kind === "line")
    .map((x) => x.r);
  // ⚠️ Cada fila de subtotal (una por categoria) y el PROJECT TOTAL recorrian
  // por su cuenta las ~19.600 combinaciones de linea x columna llamando a
  // columnTotal. Con seis categorias eso son siete barridos completos en CADA
  // render. Acá se hace UNO, memorizado: el subtotal despues solo suma de una
  // lista ya calculada.
  const totalPorLineaYColumna = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const l of allLines) {
      m.set(
        l.id,
        columns.map((c) => columnTotal(index, l.id, c.weeks)),
      );
    }
    return m;
  }, [allLines, columns, index]);

  // Ventas (proceeds) — FUERA de los totales; se muestran como referencia al final.
  const proceedsLines = (financials.data ?? []).filter((r) => r.kind === "proceeds");

  // filtro: solo las líneas que necesitan ajuste (con su encabezado de categoría)
  const displayRows: Row[] = [];
  if (!onlyIssues) displayRows.push(...rows);
  else {
    let header: Row | null = null;
    let bucket: Row[] = [];
    for (const row of rows) {
      if (row.kind === "sec") {
        header = row;
        bucket = [];
      } else if (row.kind === "line") {
        if (lineIssues(row.r, row.tl).level > 0) bucket.push(row);
      } else if (row.kind === "total") {
        if (header && bucket.length) displayRows.push(header, ...bucket);
        header = null;
      }
    }
  }

  // ---- Edición inline tipo Excel del cronograma (solo vista Semanal) ----------
  // Orden de navegación: filas = líneas visibles; columnas = semanas mostradas.
  const navRowIds = displayRows
    .filter((x): x is { kind: "line"; r: WbsFinancials; tl: number } => x.kind === "line")
    .map((x) => x.r.id);
  const navCols = columns.map((c) => c.key);
  const firstState = () => states.data?.[0]?.id ?? 1;

  // Extiende el bloque desde la celda anclada (`sel`) hasta la que se marque.
  const extenderBloque = (wbsId: number, colKey: string) => {
    const f1 = navRowIds.indexOf(wbsId);
    const c1 = navCols.indexOf(colKey);
    const f0 = sel ? navRowIds.indexOf(sel.wbsId) : f1;
    const c0 = sel ? navCols.indexOf(sel.week) : c1;
    if (f0 < 0 || c0 < 0 || f1 < 0 || c1 < 0) return;
    setBloque({
      f0: Math.min(f0, f1),
      f1: Math.max(f0, f1),
      c0: Math.min(c0, c1),
      c1: Math.max(c0, c1),
    });
    setEditBuf(null);
  };

  // Las celdas del bloque, con su monto de HOY. Solo vista semanal: en
  // Mensual/Trimestral una columna son varias semanas y "correr una columna"
  // no tiene un significado unico.
  const celdasDelBloque = () => {
    if (!bloque) return [];
    const out: { wbsId: number; ci: number; week: string; monto: number }[] = [];
    for (let f = bloque.f0; f <= bloque.f1; f++) {
      const wbsId = navRowIds[f];
      if (wbsId == null) continue;
      for (let ci = bloque.c0; ci <= bloque.c1; ci++) {
        const col = colOf(navCols[ci]);
        if (!col || col.weeks.length !== 1) continue;
        const w = col.weeks[0];
        const monto = index.get(wbsId)?.get(w)?.amount ?? 0;
        if (monto) out.push({ wbsId, ci, week: w, monto });
      }
    }
    return out;
  };

  // Corre el bloque `delta` columnas. El destino se calcula contra los montos
  // ORIGINALES: si origen y destino se pisan, no se arrastra lo ya movido.
  const moverBloque = (delta: number) => {
    if (!bloque || !delta) return;
    const celdas = celdasDelBloque();
    if (!celdas.length) return;
    // Que no se salga de la grilla ni entre al historial bloqueado.
    const destinos = celdas.map((x) => x.ci + delta);
    if (destinos.some((d) => d < minEditColIdx || d >= navCols.length)) return;

    const cambios = new Map<string, PendCell>();
    const poner = (wbsId: number, week: string, monto: number | null, st?: number) => {
      cambios.set(`${wbsId}|${week}`, {
        wbs_id: wbsId,
        week_start: week,
        planned_amount: monto,
        state_id: st,
      });
    };
    // Primero se vacia el origen...
    for (const x of celdas) poner(x.wbsId, x.week, null);
    // ...y despues se escribe el destino, sumando lo que ya hubiera ahi.
    for (const x of celdas) {
      const col = colOf(navCols[x.ci + delta]);
      if (!col || col.weeks.length !== 1) return;
      const w = col.weeks[0];
      const yaHabia = celdas.some((y) => y.wbsId === x.wbsId && y.week === w)
        ? 0 // esa celda es origen: su monto se va, no se suma
        : (index.get(x.wbsId)?.get(w)?.amount ?? 0);
      const st = index.get(x.wbsId)?.get(x.week)?.state_id ?? firstState();
      const prev = cambios.get(`${x.wbsId}|${w}`);
      const base = prev && prev.planned_amount !== null ? prev.planned_amount : yaHabia;
      poner(x.wbsId, w, Math.round((base + x.monto) * 100) / 100, st);
    }
    anotar([...cambios.values()]);
    setBloque({ ...bloque, c0: bloque.c0 + delta, c1: bloque.c1 + delta });
  };

  // ── Moverse por las columnas sin salir de donde uno esta ────────────────
  //
  // ⚠️ El problema que resuelve: la grilla mide 72vh y arranca despues de una
  // cabecera alta, asi que su barra de desplazamiento horizontal queda FUERA
  // de la pantalla; y las flechas ◀ ▶ viven en la barra de controles, que se
  // va para arriba apenas uno baja. Resultado: para correr el cronograma una
  // semana habia que irse al fondo, y al volver uno ya no sabia donde estaba.
  //
  // Tres caminos, los tres desde donde sea:
  //   · Shift + rueda del mouse sobre la grilla
  //   · Alt + ← / →  (una columna)   ·   Alt + Shift + ← / →  (un mes)
  //   · las flechas flotantes, pegadas al borde de la pantalla
  //
  // ⚠️ No se usa un ancho fijo. Las columnas declaran `minWidth: 58` pero el
  // ancho real lo decide el navegador segun el contenido, asi que un numero
  // escrito a mano deja el salto corrido y despues de diez clics uno ya no
  // cae en el borde de ninguna columna. Se MIDE el encabezado y se salta de
  // borde a borde, como hace `jumpToMonth`.
  const correr = useCallback((columnas: number) => {
    const sc = scroller.current;
    if (!sc || columnas === 0) return;
    const ths = [...sc.querySelectorAll<HTMLElement>("th[data-wk]")];
    if (ths.length === 0) return;
    const borde = sc.getBoundingClientRect().left + FROZEN_W + 4;
    // La primera columna que hoy asoma a la derecha de las congeladas.
    let i = ths.findIndex((t) => t.getBoundingClientRect().left >= borde - 1);
    if (i < 0) i = ths.length - 1;
    const destino = ths[Math.min(Math.max(i + columnas, 0), ths.length - 1)];
    if (!destino || destino === ths[i]) {
      // Ya esta en la punta: se empuja igual, para que el clic no quede mudo.
      sc.scrollBy({ left: columnas * (ths[0]?.offsetWidth || 58), behavior: "smooth" });
      return;
    }
    sc.scrollBy({
      left: destino.getBoundingClientRect().left - borde,
      behavior: "smooth",
    });
  }, []);

  // Shift + rueda: el navegador no lo hace solo cuando el contenedor tambien
  // desplaza en vertical, asi que se traduce a mano.
  useEffect(() => {
    const sc = nodoGrilla;
    if (!sc) return;
    const rueda = (e: WheelEvent) => {
      if (!e.shiftKey) return;
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (!d) return;
      e.preventDefault();
      sc.scrollLeft += d;
    };
    sc.addEventListener("wheel", rueda, { passive: false });
    return () => sc.removeEventListener("wheel", rueda);
  }, [nodoGrilla]);

  // Alt + flechas corre las COLUMNAS a la vista. Con Alt y no a secas porque
  // las flechas solas ya mueven la celda seleccionada al editar, y pisarlas
  // romperia el tecleo.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      correr(dir * (e.shiftKey ? 4 : 1));
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [correr]);

  // Escape suelta el bloque. Sin esto queda resaltado y estorba.
  useEffect(() => {
    if (!bloque) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBloque(null);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [bloque]);

  // Las flechas flotantes solo aparecen cuando la grilla esta a la vista: si
  // uno esta leyendo otra cosa, no tienen nada que mover.
  const [grillaALaVista, setGrillaALaVista] = useState(false);
  useEffect(() => {
    const sc = nodoGrilla;
    if (!sc) return;
    const obs = new IntersectionObserver(([x]) => setGrillaALaVista(x.isIntersecting), {
      threshold: 0,
    });
    obs.observe(sc);
    return () => obs.disconnect();
  }, [nodoGrilla]);

  // ── Guardar lo pendiente ────────────────────────────────────────────────
  //
  // Guarda SOLO. El buffer existe igual —para marcar en ambar lo que todavia
  // no llego, para juntar en un lote lo que se escribio seguido y para que el
  // boton siga estando cuando uno quiere forzarlo— pero nadie tiene que
  // apretar nada: a los 1.2 s sin tocar nada, se va.
  //
  // Por que con espera y no al instante: pegar un rango de Excel o tabular
  // por diez celdas seguidas generaba diez pedidos. Asi es uno solo.
  const guardar = async () => {
    if (pend.size === 0) return;
    const lote = [...pend.values()];
    // Se limpia DESPUES de que el servidor confirma. Si falla, lo escrito
    // sigue en pantalla y el boton sigue ahi para reintentar: perder el
    // trabajo de alguien por un error de red no es una opcion.
    // mutateAsync ya espera a que los datos frescos esten en la cache (el
    // onSuccess del hook devuelve las invalidaciones). Recien ahi se saca del
    // buffer: si se sacara antes, el monto desapareceria de la pantalla entre
    // el guardado y el refetch, y parece que no se guardo.
    await upsertCells.mutateAsync(lote);
    setPend((prev) => {
      const m = new Map(prev);
      for (const c of lote) {
        const k = `${c.wbs_id}|${c.week_start}`;
        if (m.get(k) === c) m.delete(k);
      }
      return m;
    });
  };

  const descartar = () => setPend(new Map());

  // El temporizador del guardado automatico. Se reinicia con cada edicion.
  const guardarRef = useRef(guardar);
  guardarRef.current = guardar;
  useEffect(() => {
    if (pend.size === 0) return;
    const t = setTimeout(() => void guardarRef.current(), 1200);
    return () => clearTimeout(t);
  }, [pend]);

  // El navegador avisa si se cierra la pestaña con cambios sin guardar. Es la
  // unica red que queda cuando el guardado dejo de ser automatico.
  useEffect(() => {
    if (pend.size === 0) return;
    const avisar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [pend.size]);
  // El HISTORIAL (columnas enteramente antes del Forecast Cut-off) está BLOQUEADO:
  // no se edita/pinta/arrastra a mano — solo cambia por el ledger. Para editarlo,
  // el owner mueve el Forecast cut-off. La celda es "pasado" si TODAS sus semanas < corte.
  const colIsPast = (c: { weeks: string[] }) =>
    cutoffDate !== "" && c.weeks.length > 0 && c.weeks.every((w) => w < cutoffDate);
  // Primera columna editable (futura) — para que el teclado no entre al historial.
  const minEditColIdx = (() => {
    const i = columns.findIndex((c) => !colIsPast(c));
    return i < 0 ? columns.length : i;
  })();

  const colOf = (key: string) => columns.find((c) => c.key === key);

  // Abre una celda/columna para editar; el buffer arranca con el TOTAL de la columna
  // (semanal = el monto de esa semana; mensual/trim = la suma del período).
  const openCell = (wbsId: number, colKey: string, initial?: string) => {
    setSel({ wbsId, week: colKey });
    if (initial !== undefined) {
      setEditBuf(initial);
      return;
    }
    const col = colOf(colKey);
    const tot = col ? columnTotal(index, wbsId, col.weeks) : 0;
    setEditBuf(tot ? String(tot) : "");
  };

  // Guarda una celda/columna. Evalúa aritmética (1000+500, =46500/3) y guarda el
  // RESULTADO. Columna de UNA semana (Semanal) → esa semana. Columna de VARIAS
  // (Mensual/Trimestral) → DISTRIBUYE el total uniforme entre sus semanas (la última
  // absorbe el redondeo). Vacío = borra todas las semanas de la columna.
  const commitColumn = (wbsId: number, col: { key: string; weeks: string[] }, buf: string) => {
    const weeks = col.weeks;
    if (weeks.length === 0) return;
    const cur = columnTotal(index, wbsId, weeks);
    const t = (buf ?? "").trim();
    if (t === "") {
      if (Math.abs(cur) > 0.005)
        anotar(weeks.map((w) => ({ wbs_id: wbsId, week_start: w, planned_amount: null })));
      return;
    }
    const val = evalMath(t) ?? Number(t.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(val)) return;
    if (Math.abs(cur - val) < 0.005) return;
    if (weeks.length === 1) {
      const st = index.get(wbsId)?.get(weeks[0])?.state_id ?? firstState();
      anotar([{ wbs_id: wbsId, week_start: weeks[0], planned_amount: val, state_id: st }]);
      return;
    }
    const per = Math.round((val / weeks.length) * 100) / 100;
    anotar(
      weeks.map((w, i) => ({
        wbs_id: wbsId,
        week_start: w,
        planned_amount:
          i === weeks.length - 1 ? Math.round((val - per * (weeks.length - 1)) * 100) / 100 : per,
      })),
    );
  };

  // Mueve la selección (dRow filas, dCol columnas) y abre la celda destino.
  const moveSel = (dRow: number, dCol: number) => {
    if (!sel) return;
    const ri = navRowIds.indexOf(sel.wbsId);
    const ci = navCols.indexOf(sel.week);
    if (ri < 0 || ci < 0) return;
    const nr = Math.min(Math.max(ri + dRow, 0), navRowIds.length - 1);
    // No dejar que las flechas entren al historial bloqueado (columnas < corte).
    const nc = Math.min(Math.max(ci + dCol, minEditColIdx), navCols.length - 1);
    openCell(navRowIds[nr], navCols[nc]);
  };

  // Pegar desde Excel: TSV (tab entre columnas, salto de línea entre filas) a partir
  // de la celda actual, en un solo guardado por lote.
  const pasteFrom = (wbsId: number, week: string, text: string) => {
    const grid = text
      .replace(/\r/g, "")
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => line.split("\t"));
    const ri0 = navRowIds.indexOf(wbsId);
    const ci0 = navCols.indexOf(week);
    if (ri0 < 0 || ci0 < 0) return;
    const cells: { wbs_id: number; week_start: string; planned_amount: number | null }[] = [];
    grid.forEach((cols, dr) =>
      cols.forEach((raw, dc) => {
        const rId = navRowIds[ri0 + dr];
        const wk = navCols[ci0 + dc];
        if (rId == null || wk == null) return;
        const tt = (raw ?? "").trim();
        if (tt === "") return;
        const v = evalMath(tt) ?? Number(tt.replace(/[^0-9.-]/g, ""));
        if (!Number.isFinite(v)) return;
        // Sin state_id → el server conserva el estado/color existente (o usa el default).
        cells.push({ wbs_id: rId, week_start: wk, planned_amount: v });
      }),
    );
    if (cells.length) anotar(cells);
  };

  // Los botones de la barra de arriba siguen moviendo ~un mes por clic.
  const scrollBy = (dir: number) => correr(dir * 4);

  if (financials.isLoading || weeks.isLoading)
    return <p className="text-sm text-slate-500">Loading Job Cost…</p>;

  const nTimeline = columns.length;

  // Saltar EXACTO a un mes: deja la primera semana de ese YYYY-MM justo después de
  // las columnas congeladas. Usa delta por getBoundingClientRect (robusto con sticky).
  const jumpToMonth = (ym: string) => {
    const sc = scroller.current;
    const el = sc?.querySelector<HTMLElement>(`th[data-wk^="${ym}"]`);
    if (!sc || !el) return;
    const delta = el.getBoundingClientRect().left - sc.getBoundingClientRect().left - FROZEN_W - 4;
    sc.scrollLeft += delta;
  };

  // Meses presentes en las columnas visibles (chips de salto rápido).
  const MONTHS_ES = [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic",
  ];
  const monthChips: { ym: string; label: string }[] = [];
  {
    const seen = new Set<string>();
    for (const c of columns) {
      const ym = String(c.weeks[0] ?? c.key).slice(0, 7);
      if (ym.length === 7 && !seen.has(ym)) {
        seen.add(ym);
        monthChips.push({ ym, label: MONTHS_ES[Number(ym.slice(5, 7)) - 1] ?? ym });
      }
    }
  }

  const md = meta.data;
  const metaItems: { label: string; value: string }[] = [
    { label: "Project", value: md?.project_name ?? "—" },
    { label: "PM", value: md?.manager ?? "—" },
    { label: "Company", value: md?.company ?? "—" },
    { label: "Currency", value: md?.report_currency ?? "—" },
    { label: "Cut-off", value: md?.cutoff_date ?? "—" },
    { label: "Updated", value: md?.updated_at?.slice(0, 10) ?? "—" },
  ];

  // Suma un subconjunto de líneas en un Tot (para subtotales por tipo gasto/venta).
  const sumTot = (lines: WbsFinancials[]): Tot => {
    const t = Z();
    for (const r of lines) {
      t.orig += num(r.budget_original);
      t.chg += num(r.budget_change);
      t.rev += num(r.budget_revised);
      t.spend += num(r.spend);
      t.rem += num(r.remaining);
      t.fc += num(r.forecast);
      t.ou += num(r.over_under);
      const act = columnTotal(index, r.id, pastWeeks);
      const fcst = columnTotal(index, r.id, futureWeeks);
      t.tl += act + fcst;
      t.act += act;
      t.fcst += fcst;
    }
    return t;
  };

  // Fila de subtotal de una sección (reutilizable: TOTAL, o TOTAL GASTOS / TOTAL
  // VENTA). `code` = número(s) de proyecto a mostrar en la columna WBS (para la venta).
  const totalRow = (
    label: string,
    ls: WbsFinancials[],
    t: Tot,
    key: string,
    code?: string,
    venta = false,
  ): ReactNode => {
    // La VENTA se pinta en verde y con borde propio para AISLARLA de los totales de gasto.
    const rowBg = venta ? "bg-[#D8F4E6]" : "bg-[#D8F4E6]";
    const rowBorder = venta ? "border-emerald-600" : "border-slate-500";
    return (
      <tr key={key} className={`border-y-2 ${rowBorder} ${rowBg} text-[12px] font-bold`}>
        <td className={`${fcls(rowBg)} py-1.5`} style={fst(0)} />
        <td className={`${fcls(rowBg)} px-1`} style={fst(1)}>
          {code ?? ""}
        </td>
        <td className={`${fcls(rowBg)} px-1 py-1.5 text-right`} style={fst(2)}>
          {label}
        </td>
        <td className={`${fcls(rowBg)} tabular px-2 text-right`} style={fst(3)}>
          {m(t.orig)}
        </td>
        <td className={`${fcls(rowBg)} tabular px-2 text-right`} style={fst(4)}>
          {m(t.chg)}
        </td>
        <td className={`${fcls(rowBg)} tabular px-2 text-right`} style={fst(5)}>
          {m(t.rev)}
        </td>
        <td className={`${fcls(rowBg)} tabular px-2 text-right`} style={fst(6)}>
          {m(t.spend)}
        </td>
        <td className={`${fcls(rowBg)} tabular px-2 text-right`} style={fst(7)}>
          {m(t.rem)}
        </td>
        <PctCell spend={t.spend} rev={t.rev} stickCls={fcls("")} stickStyle={fst(8)} />
        <td className={`${fcls(rowBg)} tabular px-2 text-right`} style={fst(9)}>
          {m(t.fc)}
        </td>
        <td
          className={`${fcls(rowBg)} tabular px-2 text-right ${t.ou > 0 ? "text-red-700" : ""}`}
          style={fst(10)}
        >
          {m(t.ou)}
        </td>
        <td colSpan={8} />
        {columns.map((c, i) => {
          const v = ls.reduce((s, l) => s + (totalPorLineaYColumna.get(l.id)?.[i] ?? 0), 0);
          return (
            <td
              key={c.key}
              data-print="hide"
              className={`tabular px-1 text-center text-xs${cutBorder(i)}`}
              title={v ? full2(v) : undefined}
            >
              {compactNode(v)}
            </td>
          );
        })}
        <td className="tabular px-2 text-right text-emerald-800">{m(t.act)}</td>
        <td className="tabular px-2 text-right text-[#8E4A10]">{m(t.fcst)}</td>
        {(() => {
          const gap = t.rev - t.tl;
          const ok = Math.abs(gap) < 1;
          return (
            <td
              className={`tabular px-2 text-right ${ok ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}
              title={
                ok
                  ? "This section's schedule matches its Revised Budget"
                  : `Revised ${usd(t.rev)} · Timeline ${usd(t.tl)} · ${usd(gap)} left to distribute`
              }
            >
              {m(t.tl)}
              {ok ? " ✓" : ""}
            </td>
          );
        })()}
        {(() => {
          const ctl = t.fc - t.tl;
          return (
            <td
              className={`tabular px-2 text-right font-medium ${Math.abs(ctl) < 1 ? "text-emerald-700" : "text-red-600"}`}
              title="Forecast − Timeline Total (should be $0)"
            >
              {Math.abs(ctl) < 1 ? "✓ $0" : m(ctl)}
            </td>
          );
        })()}
        <td className="tabular px-2 text-right font-medium text-[#2F956E]">
          {m(ls.reduce((s, l) => s + columnTotal(index, l.id, viewWeeks), 0))}
        </td>
      </tr>
    );
  };

  return (
    <div>
      <PrintBar title="Job Cost Report" />
      {/* Cabecera del reporte (Project Title / PM / Company / Cut-off / Updated) + leyenda */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {metaItems.map((it) => (
            <span key={it.label} className="text-xs text-slate-500">
              {it.label}: <b className="text-slate-800">{it.value}</b>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 print:hidden">
          {/* Guarda solo. El recuadro informa, no manda: aparece mientras algo
              esta en camino y se va cuando el servidor confirmo. El boton
              queda para forzarlo sin esperar. */}
          {pend.size > 0 ? (
            <div className="flex items-center gap-2 rounded-md border-2 border-amber-500 bg-amber-50 px-2 py-1">
              <span className="text-xs font-semibold text-amber-900">
                {upsertCells.isPending
                  ? "Saving…"
                  : `${pend.size} ${pend.size === 1 ? "change" : "changes"} to save`}
              </span>
              <button
                type="button"
                onClick={() => void guardar()}
                disabled={upsertCells.isPending}
                className="rounded bg-amber-600 px-3 py-1 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
                title="Send it now, without waiting for the automatic save"
              >
                💾 Save now
              </button>
              <button
                type="button"
                onClick={descartar}
                disabled={upsertCells.isPending}
                className="rounded border border-amber-600 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
                title="Puts the screen back the way it was before your changes"
              >
                Discard
              </button>
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["wbs"] });
              qc.invalidateQueries({ queryKey: ["schedule"] });
            }}
            disabled={financials.isFetching}
            className="rounded border border-blue-600 bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            title="Recompute all totals (Spend, Forecast, Remaining, Over/Under) from the current ledger and schedule"
          >
            {financials.isFetching ? "Recalculating…" : "🔄 Recalculate"}
          </button>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setHistOpen(true)}
              className="rounded border border-amber-600 bg-amber-50 px-3 py-1 text-sm font-medium text-amber-800 hover:bg-amber-100"
              title="Rewrite the weeks before the cut-off with the real LEDGER payments, each in the week it was paid. Shows a preview first."
            >
              ⬅ Pull history from the LEDGER
            </button>
          ) : null}
          {/* Tambien en la barra de arriba. Esta es la mano que lo busca. */}
          <BotonMasterFile tono="pagina" />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase text-slate-400">Statuses:</span>
            {(states.data ?? []).map((s) => (
              <span key={s.id} className="flex items-center gap-1 text-xs text-slate-600">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: STATE_COLOR[s.code] ?? s.color_hex }}
                />
                {s.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
        <span
          className="text-sm text-slate-500"
          title="You can select more than one year to view them together"
        >
          Years:
        </span>
        {years.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => {
              toggleYear(y);
              setSel(null);
            }}
            className={`rounded px-3 py-1 text-sm ${activeYears.includes(y) ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
          >
            {y}
          </button>
        ))}
        {activeYears.length > 1 ? (
          <span className="text-xs text-slate-400">({activeYears.length} years together)</span>
        ) : null}
        <span className="mx-1 h-5 w-px bg-slate-300" />
        <span className="text-sm text-slate-500">View by:</span>
        {(["week", "month", "quarter"] as View[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setView(v);
              setSel(null);
            }}
            className={`rounded px-3 py-1 text-sm ${view === v ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
          >
            {v === "week" ? "Weekly" : v === "month" ? "Monthly" : "Quarterly"}
          </button>
        ))}
        <span className="ml-2 flex items-center gap-1">
          <button
            type="button"
            aria-label="Left"
            className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
            onClick={() => scrollBy(-1)}
          >
            ◀
          </button>
          <button
            type="button"
            aria-label="Right"
            className="rounded border border-slate-300 px-2 py-1 text-slate-600 hover:bg-slate-50"
            onClick={() => scrollBy(1)}
          >
            ▶
          </button>
        </span>
        {/* Filtro rápido por N° de proyecto (Cost Code) / título */}
        <input
          list="wbs-filter-codes"
          placeholder="🔎 Filter by project # (e.g. 0.7)"
          className="ml-2 w-56 rounded border border-slate-300 px-2 py-1 text-sm"
          value={projFilter}
          onChange={(e) => setProjFilter(e.target.value)}
        />
        <datalist id="wbs-filter-codes">
          {(wbsList.data ?? []).map((w) => (
            <option key={w.id} value={w.wbs_code}>
              {w.title}
            </option>
          ))}
        </datalist>
        {projFilter ? (
          <button
            type="button"
            onClick={() => setProjFilter("")}
            className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-600 hover:bg-slate-50"
          >
            Clear filter
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setOnlyIssues((v) => !v)}
          className={`ml-2 rounded px-3 py-1 text-sm ${onlyIssues ? "bg-red-600 text-white" : "border border-red-300 text-red-700 hover:bg-red-50"}`}
        >
          {onlyIssues ? "View all" : "⚠ Only those needing adjustment"}
        </button>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className={`rounded px-3 py-1 text-sm ${adding ? "bg-emerald-700 text-white" : "border border-emerald-400 text-emerald-700 hover:bg-emerald-50"}`}
          >
            ＋ Add WBS line
          </button>
        ) : null}
        <span className="ml-2 text-xs text-slate-400">
          {allLines.length} lines · {weekList.length} weeks
          {canSched
            ? " · 🔒 weeks before the Forecast cut-off are locked (history from the ledger); edit the future — type numbers/math (1000+500, =46500/3), Enter/Tab/arrows, paste from Excel; in Monthly/Quarterly a total spreads across the period · what you type stays amber until you press 💾 Save · to run the columns from wherever you are: Shift+wheel, Alt+←/→ (Alt+Shift for a whole month) or the floating arrows on the right edge · to move a BLOCK: click one cell, Shift+click the far end, then use the bar at the bottom (Esc releases it)"
            : ""}
        </span>
        {/* Fecha de corte del Forecast: el timeline desde acá cuenta como futuro */}
        <div className="ml-auto flex items-center gap-1 text-xs text-slate-500">
          <span title="Forecast = Spend + timeline from this date. 🔒 Everything BEFORE this date is locked (history, from the ledger) — move it back to edit older weeks.">
            🔒 Forecast cut-off:
          </span>
          <input
            type="date"
            className="rounded border border-slate-300 px-1 py-0.5 text-xs"
            value={cutoff.data?.cutoff_date ?? ""}
            disabled={!canEdit}
            onChange={(e) => e.target.value && setCutoff.mutate(e.target.value)}
          />
        </div>
      </div>

      {monthChips.length > 1 ? (
        <div className="mb-2 flex flex-wrap items-center gap-1 print:hidden">
          <span className="mr-1 text-xs text-slate-500">Jump to month:</span>
          {monthChips.map((mc) => (
            <button
              key={mc.ym}
              type="button"
              onClick={() => jumpToMonth(mc.ym)}
              title={`Scroll the timeline to ${mc.ym}`}
              className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-blue-50 hover:text-blue-700"
            >
              {mc.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center gap-2 print:hidden">
        <span className="text-xs text-slate-400">
          Paint the execution{" "}
          {view === "week" ? "by week" : view === "month" ? "by month" : "by quarter"} (color = the
          project's):
        </span>
        <PaintToolbar tool={paint} />
        {canSched && !paint.paintOn && view === "week" ? (
          <span className="text-xs text-slate-400">
            · 🖐 Drag a cell with an amount and drop it on another week to move it
          </span>
        ) : null}
      </div>

      {adding ? (
        <AddWbsForm
          categories={categories.data ?? []}
          phases={phases.data ?? []}
          onDone={() => setAdding(false)}
        />
      ) : null}

      {(() => {
        const gap = grand.rev - grand.tl;
        // Tolerancia $5: el gap real suele ser ruido de centavos acumulado en ~76 líneas.
        const cuadra = Math.abs(gap) < 5;
        const flagged = allLines.reduce((n, l) => {
          const line = rows.find(
            (x): x is { kind: "line"; r: WbsFinancials; tl: number } =>
              x.kind === "line" && x.r.id === l.id,
          );
          return n + (line && lineIssues(l, line.tl).level > 0 ? 1 : 0);
        }, 0);
        return (
          <div className="mb-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
            Schedule reconciliation: <b className="tabular">{usd(grand.tl)}</b> distributed on the
            timeline vs <b className="tabular">{usd(grand.rev)}</b> Revised Budget
            {cuadra ? (
              <span className="font-medium text-emerald-700"> · balanced ✓</span>
            ) : (
              <span className="font-medium text-amber-700">
                {" "}
                · <span className="tabular">{usd(gap)}</span> left to distribute
              </span>
            )}
            {flagged > 0 ? (
              <span className="ml-1 font-medium text-red-600">
                {" "}
                · ⚠ {flagged} lines need adjustment
              </span>
            ) : (
              <span className="ml-1 font-medium text-emerald-700"> · all lines OK ✓</span>
            )}
          </div>
        );
      })()}

      {/* La barra del bloque: aparece cuando hay mas de una celda marcada y
          muestra que se va a mover antes de moverlo. Va pegada al borde de la
          PANTALLA, como las flechas, para que no se escape al desplazarse. */}
      {bloque && (bloque.f1 > bloque.f0 || bloque.c1 > bloque.c0) ? (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 print:hidden">
          <div className="flex items-center gap-2 rounded-lg border-2 border-blue-500 bg-white px-3 py-2 shadow-xl">
            <span className="text-xs font-semibold text-blue-900">
              {bloque.f1 - bloque.f0 + 1} {bloque.f1 === bloque.f0 ? "line" : "lines"} ×{" "}
              {bloque.c1 - bloque.c0 + 1} {bloque.c1 === bloque.c0 ? "week" : "weeks"}
              <span className="ml-2 tabular font-bold">
                {usd(celdasDelBloque().reduce((a, x) => a + x.monto, 0))}
              </span>
            </span>
            {[
              [-4, "⏪", "One month back"],
              [-1, "◀", "One week back"],
              [1, "▶", "One week forward"],
              [4, "⏩", "One month forward"],
            ].map(([d, txt, t]) => (
              <button
                key={String(d)}
                type="button"
                onClick={() => moverBloque(Number(d))}
                title={String(t)}
                className="rounded border border-blue-600 px-2 py-1 text-sm font-semibold text-blue-700 hover:bg-blue-50"
              >
                {txt}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setBloque(null)}
              title="Release the block (Esc)"
              className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      {/* Flechas flotantes: pegadas al borde de la pantalla, no a la pagina,
          asi que estan donde sea que uno este mirando. Aparecen solo mientras
          la grilla esta a la vista. */}
      {grillaALaVista ? (
        <div className="pointer-events-none fixed inset-y-0 right-0 z-30 flex items-center pr-2 print:hidden">
          <div className="pointer-events-auto flex flex-col gap-1 rounded-lg border border-slate-300 bg-white/95 p-1 shadow-lg backdrop-blur">
            <button
              type="button"
              aria-label="One month left"
              title="One month back  ·  Alt+Shift+←"
              onClick={() => correr(-4)}
              className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
            >
              ⏮
            </button>
            <button
              type="button"
              aria-label="One column left"
              title="One column back  ·  Alt+←  ·  Shift+wheel"
              onClick={() => correr(-1)}
              className="rounded px-2 py-1 text-base text-slate-700 hover:bg-slate-100"
            >
              ◀
            </button>
            <button
              type="button"
              aria-label="One column right"
              title="One column forward  ·  Alt+→  ·  Shift+wheel"
              onClick={() => correr(1)}
              className="rounded px-2 py-1 text-base text-slate-700 hover:bg-slate-100"
            >
              ▶
            </button>
            <button
              type="button"
              aria-label="One month right"
              title="One month forward  ·  Alt+Shift+→"
              onClick={() => correr(4)}
              className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
            >
              ⏭
            </button>
          </div>
        </div>
      ) : null}

      <div
        ref={fijarGrilla}
        className="max-h-[72vh] overflow-auto rounded-lg border border-slate-200 bg-white"
      >
        <table className="border-collapse text-xs">
          <thead className="bg-[#151916] text-left text-white">
            <tr>
              <th className={`${fhead("bg-[#151916]")} px-1 py-2 text-center`} style={fst(0)}>
                St
              </th>
              <th className={`${fhead("bg-[#151916]")} px-1 py-2`} style={fst(1)}>
                WBS
              </th>
              <th className={`${fhead("bg-[#151916]")} px-1 py-2`} style={fst(2)}>
                Task Title
              </th>
              <ColHead
                label="Orig. Budget"
                help={COL_HELP.orig}
                className={`${fhead("bg-[#151916]")} ${MONEYTH}`}
                style={fst(3)}
                align="right"
              />
              <ColHead
                label="Changes"
                help={COL_HELP.changes}
                className={`${fhead("bg-[#151916]")} ${MONEYTH}`}
                style={fst(4)}
                align="right"
              />
              <ColHead
                label="Revised"
                help={COL_HELP.revised}
                className={`${fhead("bg-[#151916]")} ${MONEYTH}`}
                style={fst(5)}
                align="right"
              />
              <ColHead
                label="Spend"
                help={COL_HELP.spend}
                className={`${fhead("bg-[#151916]")} ${MONEYTH}`}
                style={fst(6)}
                align="right"
              />
              <ColHead
                label="Remaining"
                help={COL_HELP.remaining}
                className={`${fhead("bg-[#151916]")} ${MONEYTH}`}
                style={fst(7)}
                align="right"
              />
              <ColHead
                label="% Compl"
                help={COL_HELP.pct}
                className={`${fhead("bg-[#151916]")} ${MONEYTH}`}
                style={fst(8)}
                align="right"
              />
              <ColHead
                label="Forecast"
                help={COL_HELP.forecast}
                className={`${fhead("bg-[#151916]")} ${MONEYTH}`}
                style={fst(9)}
                align="right"
              />
              <ColHead
                label="Over/Under"
                help={COL_HELP.overunder}
                className={`${fhead("bg-[#151916]")} ${MONEYTH}`}
                style={fst(10)}
                align="right"
              />
              <th className={`${THH} px-2 py-2`}>Owner</th>
              <th className={`${THH} px-2 py-2`}>Category</th>
              <th className={`${THH} px-2 py-2`}>Phase</th>
              <th className={`${THH} px-2 py-2 text-xs uppercase whitespace-nowrap`}>Start</th>
              <th className={`${THH} px-2 py-2 text-xs uppercase whitespace-nowrap`}>Due</th>
              <th
                className={`${THH} px-2 py-2 text-center text-xs uppercase`}
                title="Duration in days (DAYS360 between Start and Due, like Excel)"
              >
                Dur
              </th>
              <th
                className={`${THH} px-2 py-2 text-center text-xs uppercase`}
                title="Current draw (last disbursement that touches the line)"
              >
                Curr Draw
              </th>
              <th
                className={`${THH} px-2 py-2 text-center text-xs uppercase`}
                title="First draw in which the line appears"
              >
                Draw #
              </th>
              {columns.map((c, i) => (
                <th
                  key={c.key}
                  data-wk={String(c.weeks[0] ?? c.key)}
                  data-print="hide"
                  className={`${THH} px-1 py-1 text-center text-xs${cutBorder(i)}`}
                  style={{ minWidth: 58 }}
                >
                  <div>{c.label}</div>
                  <div className="text-xs text-slate-300">{c.sub}</div>
                </th>
              ))}
              <th
                className="sticky top-0 z-30 bg-[#005C40] px-2 py-2 text-right text-xs uppercase"
                style={{ minWidth: 90 }}
                title="Actual = the timeline BEFORE the Forecast cut-off (executed / paid, from the ledger)"
              >
                Actual
              </th>
              <th
                className="sticky top-0 z-30 bg-[#8E4A10] px-2 py-2 text-right text-xs uppercase"
                style={{ minWidth: 90 }}
                title="Forecast = the timeline FROM the Forecast cut-off onward (the plan)"
              >
                Forecast
              </th>
              <ColHead
                label="Timeline Total"
                help={COL_HELP.tltotal}
                className="sticky top-0 z-30 bg-[#151916] px-2 py-2 text-right text-xs uppercase"
                style={{ minWidth: 90 }}
                align="right"
              />
              <ColHead
                label="Control"
                help={COL_HELP.control}
                className="sticky top-0 z-30 bg-[#005C40] px-2 py-2 text-right text-xs uppercase"
                style={{ minWidth: 80 }}
                align="right"
              />
              <th
                className="sticky top-0 z-30 bg-[#2F956E] px-2 py-2 text-right text-xs uppercase"
                style={{ minWidth: 90 }}
                title={`Total of the selected year(s): ${activeYears.join(", ")}`}
              >
                Year Total
                <div className="text-xs font-normal text-teal-100">{activeYears.join(", ")}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              if (row.kind === "sec")
                return (
                  <tr key={`sec-${row.sec}`} className="border-t-2 border-slate-400 bg-[#F0F1EB]">
                    <td
                      className={`${fcls("bg-[#F0F1EB]")} px-1 text-center font-bold text-slate-700`}
                      style={fst(0)}
                    >
                      {row.sec}
                    </td>
                    <td className={fcls("bg-[#F0F1EB]")} style={fst(1)} />
                    <td
                      className={`${fcls("bg-[#F0F1EB]")} whitespace-nowrap px-1 py-1.5 text-[12px] font-bold uppercase text-slate-800`}
                      style={fst(2)}
                    >
                      {row.title}
                    </td>
                    <td
                      colSpan={8}
                      className={fcls("bg-[#F0F1EB]")}
                      style={{
                        left: LCX[3],
                        width: FROZEN_W - LCX[3],
                        minWidth: FROZEN_W - LCX[3],
                      }}
                    />
                    <td colSpan={nTimeline + 13} className="bg-[#F0F1EB]" />
                  </tr>
                );
              if (row.kind === "total") {
                const ls = linesOf(row.sec);
                const sales = ls.filter((l) => l.kind === "proceeds");
                // Sin venta: un solo TOTAL. Con venta (ej. Cinco Ventanas): dos
                // subtotales — TOTAL GASTOS (poner el lote en venta) y TOTAL VENTA.
                if (sales.length === 0) return totalRow("TOTAL", ls, row.t, `tot-${row.sec}`);
                const costs = ls.filter((l) => l.kind !== "proceeds");
                const saleCode = sales.map((l) => l.wbs_code).join(", ");
                return [
                  totalRow("TOTAL EXPENSES", costs, sumTot(costs), `totg-${row.sec}`),
                  totalRow("TOTAL SALE", sales, sumTot(sales), `totv-${row.sec}`, saleCode, true),
                ];
              }
              // La línea de venta (proceeds) NO se lista arriba: va solo en TOTAL VENTA.
              if (row.r.kind === "proceeds") return null;
              const r = row.r;
              const iss = lineIssues(r, row.tl);
              const rowMeta = metaById.get(r.id);
              const catId = rowMeta?.category_id ?? null;
              const phaseId = rowMeta?.phase_id ?? null;
              const stateId =
                rowMeta?.state_id ?? (states.data ?? []).find((s) => s.code === r.state)?.id;
              const phaseOpts = (phases.data ?? [])
                .filter((p) => catId !== null && p.category_id === catId)
                .map((p) => ({ id: p.id, label: p.name }));
              return (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className={`${fcls("bg-white")} px-1`} style={fst(0)}>
                    <StateCell
                      stateId={stateId}
                      states={states.data ?? []}
                      canEdit={canEdit}
                      onSave={(v) => editMeta.mutate({ id: r.id, state_id: v })}
                      issue={
                        iss.level > 0 ? (
                          <span
                            className={iss.level === 2 ? "text-red-600" : "text-amber-500"}
                            title={iss.msgs.join(" · ")}
                          >
                            ⚠
                          </span>
                        ) : null
                      }
                    />
                  </td>
                  <td
                    className={`${fcls("bg-white")} whitespace-nowrap px-1 font-mono text-xs text-slate-500`}
                    style={fst(1)}
                  >
                    {r.wbs_code}
                  </td>
                  <td className={`${fcls("bg-white")} px-1`} style={fst(2)}>
                    <div className="flex items-center gap-1">
                      <div className="min-w-0 flex-1" title={r.title}>
                        <EditableTextCell
                          value={r.title}
                          canEdit={canEdit}
                          onSave={(v) => editMeta.mutate({ id: r.id, title: v })}
                        />
                      </div>
                      {canEdit ? (
                        <button
                          type="button"
                          title="Void line (not deleted; hidden from the report)"
                          className="shrink-0 text-slate-300 hover:text-red-600"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Void line ${r.wbs_code}? It is not deleted; it is hidden from the report.`,
                              )
                            )
                              editMeta.mutate({ id: r.id, is_active: false });
                          }}
                        >
                          ✕
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className={`${fcls("bg-white")} px-1 text-right`} style={fst(3)}>
                    <EditableNumCell
                      value={num(r.budget_original)}
                      canEdit={canEdit}
                      onSave={(v) => upd.mutate({ id: r.id, budget_original_ovr: v })}
                    />
                  </td>
                  <td className={`${fcls("bg-white")} px-1 text-right`} style={fst(4)}>
                    <EditableNumCell
                      value={num(r.budget_change)}
                      canEdit={canEdit}
                      onSave={(v) => upd.mutate({ id: r.id, budget_change_ovr: v })}
                    />
                  </td>
                  <td
                    className={`${fcls("bg-white")} tabular px-2 text-right font-medium`}
                    style={fst(5)}
                  >
                    {m(num(r.budget_revised))}
                  </td>
                  <td
                    className={`${fcls("bg-white")} tabular cursor-help px-2 text-right text-slate-600`}
                    style={fst(6)}
                    title="Comes from the Ledger (Amount Paid by cost code). Edit it in the Ledger tab."
                  >
                    {m(num(r.spend))}
                  </td>
                  <td
                    className={`${fcls("bg-white")} tabular px-2 text-right ${num(r.remaining) < 0 ? "text-red-600" : ""}`}
                    style={fst(7)}
                  >
                    {m(num(r.remaining))}
                  </td>
                  <PctCell
                    spend={num(r.spend)}
                    rev={num(r.budget_revised)}
                    stickCls={fcls("")}
                    stickStyle={fst(8)}
                  />
                  <td className={`${fcls("bg-white")} px-1 text-right`} style={fst(9)}>
                    <ForecastCell r={r} canEdit={canEdit} onSave={setFc.mutate} />
                  </td>
                  <td
                    className={`${fcls("bg-white")} tabular px-2 text-right ${num(r.over_under) > 0 ? "text-red-700" : "text-slate-400"}`}
                    style={fst(10)}
                    title={`Over/Under = Forecast − Revised = ${usd(num(r.forecast))} − ${usd(num(r.budget_revised))} = ${usd(num(r.over_under))}. Negative = the Forecast is below budget (schedule not yet distributed).`}
                  >
                    {num(r.over_under) !== 0 ? m(num(r.over_under)) : "—"}
                  </td>
                  <td className="px-2 text-slate-500">
                    <EditableTextCell
                      value={r.owner ?? ""}
                      canEdit={canEdit}
                      allowEmpty
                      onSave={(v) => editMeta.mutate({ id: r.id, owner: v === "" ? null : v })}
                    />
                  </td>
                  <td className="px-2 text-slate-500">
                    <SelectCell
                      value={catId}
                      options={catOpts}
                      canEdit={canEdit}
                      onChange={(v) =>
                        reassign.mutate({ id: r.id, category_id: v, phase_id: null })
                      }
                    />
                  </td>
                  <td className="px-2 text-slate-500">
                    <SelectCell
                      value={phaseId}
                      options={phaseOpts}
                      canEdit={canEdit}
                      disabled={catId === null}
                      placeholder={catId === null ? "(no category)" : "—"}
                      onChange={(v) =>
                        reassign.mutate({ id: r.id, category_id: catId, phase_id: v })
                      }
                    />
                  </td>
                  <td className="px-1">
                    <EditableDateCell
                      value={r.start_date}
                      canEdit={canEdit}
                      onSave={(v) => updDates.mutate({ id: r.id, start_date: v })}
                    />
                  </td>
                  <td className="px-1">
                    <EditableDateCell
                      value={r.due_date}
                      canEdit={canEdit}
                      onSave={(v) => updDates.mutate({ id: r.id, due_date: v })}
                    />
                  </td>
                  <td
                    className="tabular px-1 text-center text-slate-500"
                    title="DAYS360(Start, Due)"
                  >
                    {r.duration_days !== null ? (
                      r.duration_days
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-2 text-center text-slate-500">
                    {r.draw_no !== null ? (
                      `#${r.draw_no}`
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-2 text-center text-slate-500">
                    {r.draw_no_first !== null ? (
                      `#${r.draw_no_first}`
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  {columns.map((c, i) => {
                    const isWeek = view === "week";
                    const rowIdx = index.get(r.id);
                    const cell = isWeek ? rowIdx?.get(c.key) : undefined;
                    const val = isWeek ? (cell?.amount ?? 0) : columnTotal(index, r.id, c.weeks);
                    // Color = el del proyecto/categoría. En Mes/Trim el período se
                    // pinta si CUALQUIERA de sus semanas está marcada.
                    const hasCell = isWeek ? !!cell : c.weeks.some((w) => rowIdx?.has(w));
                    const bg = paint.cellBg(r.category ?? "", hasCell);
                    const isSel = sel?.wbsId === r.id && sel?.week === c.key;
                    const editing = isSel && editBuf !== null;
                    // HISTORIAL BLOQUEADO: columna antes del corte = solo ledger, no editable.
                    const colPast = colIsPast(c);
                    // Pintar: semana → esa celda; mes/trim → todas sus semanas.
                    const doPaint = () => {
                      if (isWeek) paint.paintCell(r.id, c.key, cell?.amount ?? null);
                      else
                        for (const w of c.weeks)
                          paint.paintCell(r.id, w, rowIdx?.get(w)?.amount ?? null);
                    };
                    const canPaintHere = canSched && c.weeks.length > 0 && !colPast;
                    // Arrastrar-y-soltar para mover montos entre SEMANAS (misma línea),
                    // solo en vista semanal, fuera del pincel y en el futuro (no historial).
                    const canDrag =
                      isWeek && canSched && !paint.paintOn && !colPast && Math.abs(val) > 0.0001;
                    const isDropTarget =
                      isWeek &&
                      !colPast &&
                      !!dragSrc &&
                      dragSrc.wbsId === r.id &&
                      dragSrc.key !== c.key &&
                      !paint.paintOn;
                    // Sin guardar: cualquiera de las semanas de esta columna
                    // esta en el buffer. Se marca en ambar para que se vea
                    // DONDE quedo el trabajo, no solo cuantos cambios hay.
                    const sinGuardar = c.weeks.some((w) => pend.has(clave(r.id, w)));
                    // ¿Esta celda cae dentro del bloque seleccionado?
                    const enBloque = (() => {
                      if (!bloque) return false;
                      const f = navRowIds.indexOf(r.id);
                      const ci = navCols.indexOf(c.key);
                      return f >= bloque.f0 && f <= bloque.f1 && ci >= bloque.c0 && ci <= bloque.c1;
                    })();
                    return (
                      <td
                        key={c.key}
                        data-print="hide"
                        title={sinGuardar ? "Unsaved — press Save" : undefined}
                        className={`p-0 text-center${cutBorder(i)}${
                          sinGuardar ? " bg-amber-100 ring-2 ring-inset ring-amber-500" : ""
                        }${enBloque ? " bg-blue-100 ring-1 ring-inset ring-blue-500" : ""}`}
                        onDragOver={(e) => {
                          if (isDropTarget) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }
                        }}
                        onDrop={(e) => {
                          if (isDropTarget) {
                            e.preventDefault();
                            void moveColumn(r.id, dragSrc.weeks, c.weeks, index.get(r.id));
                          }
                          setDragSrc(null);
                        }}
                      >
                        {editing ? (
                          <input
                            key={`ed-${r.id}-${c.key}`}
                            // biome-ignore lint/a11y/noAutofocus: edición tipo Excel — la celda seleccionada debe enfocarse al navegar con teclado
                            autoFocus
                            value={editBuf ?? ""}
                            inputMode="text"
                            title="Type a number or a calculation: 1000+500, 155000*0.3, =46500/3. Enter/Tab/arrows move; paste from Excel."
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => setEditBuf(e.target.value)}
                            onPaste={(e) => {
                              const txt = e.clipboardData.getData("text/plain");
                              // Pegar bloque solo en vista Semanal (cada celda = una semana).
                              if (isWeek && txt && /[\t\n]/.test(txt)) {
                                e.preventDefault();
                                pasteFrom(r.id, c.key, txt);
                              }
                            }}
                            onKeyDown={(e) => {
                              const buf = editBuf ?? "";
                              const atStart = e.currentTarget.selectionStart === 0;
                              const atEnd = e.currentTarget.selectionStart === buf.length;
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitColumn(r.id, c, buf);
                                moveSel(1, 0);
                              } else if (e.key === "Tab") {
                                e.preventDefault();
                                commitColumn(r.id, c, buf);
                                moveSel(0, e.shiftKey ? -1 : 1);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setEditBuf(null);
                                setSel(null);
                              } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                commitColumn(r.id, c, buf);
                                moveSel(-1, 0);
                              } else if (e.key === "ArrowDown") {
                                e.preventDefault();
                                commitColumn(r.id, c, buf);
                                moveSel(1, 0);
                              } else if (e.key === "ArrowLeft" && atStart) {
                                e.preventDefault();
                                commitColumn(r.id, c, buf);
                                moveSel(0, -1);
                              } else if (e.key === "ArrowRight" && atEnd) {
                                e.preventDefault();
                                commitColumn(r.id, c, buf);
                                moveSel(0, 1);
                              }
                            }}
                            onBlur={() => commitColumn(r.id, c, editBuf ?? "")}
                            className="tabular block min-h-[16px] w-full bg-white px-1 text-xs text-slate-900 outline-none ring-2 ring-inset ring-blue-600"
                          />
                        ) : (
                          <button
                            type="button"
                            disabled={!canSched}
                            draggable={canDrag}
                            title={
                              colPast
                                ? val
                                  ? `${full2(val)} — 🔒 History (from the ledger). Move the Forecast cut-off back to edit.`
                                  : "🔒 History (from the ledger) — locked. Move the Forecast cut-off back to edit."
                                : canDrag
                                  ? `${full2(val)} — drag to move to another week`
                                  : !canSched
                                    ? val
                                      ? full2(val)
                                      : undefined
                                    : isWeek
                                      ? val
                                        ? `${full2(val)} — click to edit`
                                        : "Click to enter a number or formula"
                                      : "Click to enter a TOTAL — it spreads evenly across this period's weeks"
                            }
                            onDragStart={(e) => {
                              setDragSrc({ wbsId: r.id, key: c.key, weeks: c.weeks });
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", c.key);
                            }}
                            onDragEnd={() => setDragSrc(null)}
                            onClick={(e) => {
                              if (!canSched || paint.paintOn || colPast) return;
                              // Shift+clic estira el bloque desde la celda
                              // anclada; el clic a secas vuelve a una sola.
                              if (e.shiftKey) {
                                extenderBloque(r.id, c.key);
                                return;
                              }
                              setBloque(null);
                              openCell(r.id, c.key, val ? String(val) : "");
                            }}
                            {...(canPaintHere && paint.paintOn ? paint.cellPaint(doPaint) : {})}
                            className={`tabular block min-h-[16px] w-full px-1 text-xs ${colPast ? "cursor-default" : canSched && paint.paintOn ? "cursor-crosshair" : canDrag ? "cursor-grab hover:ring-1 hover:ring-inset hover:ring-blue-400" : canSched ? "cursor-pointer hover:ring-1 hover:ring-inset hover:ring-blue-400" : ""} ${isSel ? "ring-2 ring-inset ring-slate-900" : ""} ${isDropTarget ? "outline outline-2 outline-dashed outline-blue-500" : ""}`}
                            style={{
                              // Si la celda tiene cifra, se atenúa el color (50% hacia
                              // blanco) para leer bien el número; si no, color pleno.
                              backgroundColor: bg ? (val ? softenHex(bg) : bg) : undefined,
                              color: val ? "#0f172a" : "#cbd5e1",
                            }}
                          >
                            {compactNode(val) || (isWeek && canSched ? "·" : "")}
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="tabular bg-[#eafaf0] px-2 text-right font-medium text-emerald-800">
                    {m(columnTotal(index, r.id, pastWeeks))}
                  </td>
                  <td className="tabular bg-[#fbf6e7] px-2 text-right font-medium text-[#8E4A10]">
                    {m(columnTotal(index, r.id, futureWeeks))}
                  </td>
                  <td className="tabular bg-[#FBFAF6] px-2 text-right font-medium">{m(row.tl)}</td>
                  {(() => {
                    const ctl = num(r.forecast) - row.tl;
                    return (
                      <td
                        className={`tabular px-2 text-right ${Math.abs(ctl) < 1 ? "text-emerald-600" : "text-red-600"}`}
                        title={`Forecast ${usd(num(r.forecast))} − Timeline ${usd(row.tl)}`}
                      >
                        {Math.abs(ctl) < 1 ? "✓" : m(ctl)}
                      </td>
                    );
                  })()}
                  <td className="tabular bg-[#e6f4f5] px-2 text-right font-medium text-[#2F956E]">
                    {m(columnTotal(index, r.id, viewWeeks))}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-10">
            <tr className="border-t-2 border-slate-800 bg-[#B8E8D2] font-bold">
              <td className={`${fcls("bg-[#B8E8D2]", "z-30")}`} style={fst(0)} />
              <td className={`${fcls("bg-[#B8E8D2]", "z-30")}`} style={fst(1)} />
              <td className={`${fcls("bg-[#B8E8D2]", "z-30")} px-1 py-2`} style={fst(2)}>
                PROJECT TOTAL
              </td>
              <td
                className={`${fcls("bg-[#B8E8D2]", "z-30")} tabular px-2 py-2 text-right`}
                style={fst(3)}
              >
                {m(grand.orig)}
              </td>
              <td
                className={`${fcls("bg-[#B8E8D2]", "z-30")} tabular px-2 py-2 text-right`}
                style={fst(4)}
              >
                {m(grand.chg)}
              </td>
              <td
                className={`${fcls("bg-[#B8E8D2]", "z-30")} tabular px-2 py-2 text-right`}
                style={fst(5)}
              >
                {m(grand.rev)}
              </td>
              <td
                className={`${fcls("bg-[#B8E8D2]", "z-30")} tabular px-2 py-2 text-right`}
                style={fst(6)}
              >
                {m(grand.spend)}
              </td>
              <td
                className={`${fcls("bg-[#B8E8D2]", "z-30")} tabular px-2 py-2 text-right`}
                style={fst(7)}
              >
                {m(grand.rem)}
              </td>
              <PctCell
                spend={grand.spend}
                rev={grand.rev}
                foot
                stickCls={fcls("", "z-30")}
                stickStyle={fst(8)}
              />
              <td
                className={`${fcls("bg-[#B8E8D2]", "z-30")} tabular px-2 py-2 text-right`}
                style={fst(9)}
              >
                {m(grand.fc)}
              </td>
              <td
                className={`${fcls("bg-[#B8E8D2]", "z-30")} tabular px-2 py-2 text-right ${grand.ou > 0 ? "text-red-700" : ""}`}
                style={fst(10)}
              >
                {m(grand.ou)}
              </td>
              <td colSpan={8} />
              {columns.map((c, i) => {
                const v = allLines.reduce(
                  (s, l) => s + (totalPorLineaYColumna.get(l.id)?.[i] ?? 0),
                  0,
                );
                return (
                  <td
                    key={c.key}
                    data-print="hide"
                    className={`tabular px-1 py-2 text-center text-xs${cutBorder(i)}`}
                    title={v ? full2(v) : undefined}
                  >
                    {compactNode(v)}
                  </td>
                );
              })}
              <td className="tabular bg-[#eafaf0] px-2 py-2 text-right text-emerald-900">
                {m(grand.act)}
              </td>
              <td className="tabular bg-[#fbf6e7] px-2 py-2 text-right text-[#8E4A10]">
                {m(grand.fcst)}
              </td>
              {(() => {
                const gap = grand.rev - grand.tl;
                const ok = Math.abs(gap) < 1;
                return (
                  <td
                    className={`tabular px-2 py-2 text-right ${ok ? "bg-emerald-200 text-emerald-900" : "bg-amber-200 text-amber-900"}`}
                    title={
                      ok
                        ? "The schedule matches the project's Revised Budget"
                        : `Revised ${usd(grand.rev)} · Timeline ${usd(grand.tl)} · ${usd(gap)} left to distribute`
                    }
                  >
                    {m(grand.tl)}
                    {ok ? " ✓" : ""}
                  </td>
                );
              })()}
              {(() => {
                const ctl = grand.fc - grand.tl;
                const ok = Math.abs(ctl) < 1;
                return (
                  <td
                    className={`tabular px-2 py-2 text-right ${ok ? "bg-emerald-200 text-emerald-900" : "bg-red-200 text-red-900"}`}
                    title={`Control = Forecast ${usd(grand.fc)} − Timeline ${usd(grand.tl)} (should be $0)`}
                  >
                    {ok ? "✓ $0" : m(ctl)}
                  </td>
                );
              })()}
              <td className="tabular bg-[#2F956E] px-2 py-2 text-right text-white">
                {m(allLines.reduce((s, l) => s + columnTotal(index, l.id, viewWeeks), 0))}
              </td>
            </tr>
            {/* VENTA como referencia — FUERA de los totales de arriba.
                ⚠️ Cada cifra va BAJO SU COLUMNA, igual que en PROJECT TOTAL.
                Antes era un texto suelto («Revised $X · Forecast $Y») estirado
                sobre colSpan={99} y pegado a la derecha, a 99 columnas de la
                columna «Budget Revised» que le corresponde. Que la fila exista
                no es lo mismo que la fila se lea: en la linea de la venta —que
                esta FUERA de los totales a proposito— el monto tiene que verse
                al lado del presupuesto, porque si no nadie puede comprobar que
                quedo afuera. */}
            {proceedsLines.map((p) => {
              const cel = `${fcls("bg-emerald-50", "z-30")} tabular px-2 py-1.5 text-right font-semibold`;
              return (
                <tr
                  key={`ref-${p.id}`}
                  className="border-t border-emerald-400 bg-emerald-50 text-xs italic text-emerald-900"
                >
                  <td className={fcls("bg-emerald-50", "z-30")} style={fst(0)} />
                  <td className={`${fcls("bg-emerald-50", "z-30")} px-1`} style={fst(1)}>
                    {p.wbs_code}
                  </td>
                  <td className={`${fcls("bg-emerald-50", "z-30")} px-1 py-1.5`} style={fst(2)}>
                    ↓ Reference — {p.title} (sale, NOT in totals)
                  </td>
                  {/* Original y Change van en blanco a proposito: lo que importa
                      de la venta es el revisado, y rellenar las cinco columnas
                      invita a sumarlas con el resto. */}
                  <td className={fcls("bg-emerald-50", "z-30")} style={fst(3)} />
                  <td className={fcls("bg-emerald-50", "z-30")} style={fst(4)} />
                  <td className={cel} style={fst(5)}>
                    {m(num(p.budget_revised))}
                  </td>
                  <td className={fcls("bg-emerald-50", "z-30")} style={fst(6)} />
                  <td className={fcls("bg-emerald-50", "z-30")} style={fst(7)} />
                  <td className={fcls("bg-emerald-50", "z-30")} style={fst(8)} />
                  <td className={cel} style={fst(9)}>
                    {m(num(p.forecast))}
                  </td>
                  <td className={fcls("bg-emerald-50", "z-30")} style={fst(10)} />
                  <td colSpan={8} className="bg-emerald-50" />
                  <td colSpan={columns.length + 1} className="bg-emerald-50" />
                </tr>
              );
            })}
          </tfoot>
        </table>
      </div>

      {/* Traer historial del LEDGER: vista previa primero, aplicar despues. */}
      {histOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-lg bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">Pull history from the LEDGER</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Rewrites the weeks before the cut-off with the real LEDGER payments, each one in
                  the week it was paid. Nothing from the cut-off onward is touched.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistOpen(false)}
                className="rounded px-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            </div>

            {hist.isPending ? <p className="text-sm text-slate-500">Calculating…</p> : null}
            {hist.error ? (
              <p className="text-sm text-red-600">Could not compute the preview.</p>
            ) : null}

            {hist.data ? (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-4">
                  <div>
                    <div className="text-slate-500">Cut-off</div>
                    <div className="font-semibold">{hist.data.cutoff_date}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Rebuilt</div>
                    <div className="font-semibold">{hist.data.a_reconstruir} lines</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Cells</div>
                    <div className="font-semibold">
                      −{hist.data.celdas_a_borrar} / +{hist.data.celdas_a_escribir}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Total adjustment</div>
                    <div className="tabular font-semibold">{m(num(hist.data.ajuste_total))}</div>
                  </div>
                </div>

                {hist.data.bloqueadas_sin_fecha > 0 ? (
                  <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    ⚠ {hist.data.bloqueadas_sin_fecha} line(s) are left untouched: they have
                    payments with no date in the LEDGER, so there is no way to know which week they
                    belong to. Set the date in the Ledger tab and run this again.
                  </p>
                ) : null}

                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 text-left text-slate-600">
                      <tr>
                        <th className="px-2 py-1">WBS</th>
                        <th className="px-2 py-1">Line</th>
                        <th className="px-2 py-1 text-right">Painted today</th>
                        <th className="px-2 py-1 text-right">Becomes</th>
                        <th className="px-2 py-1 text-right">Change</th>
                        <th className="px-2 py-1">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {hist.data.detalle.map((d) => (
                        <tr
                          key={d.wbs_code}
                          className={d.estado === "sin_fecha" ? "bg-amber-50/60" : undefined}
                        >
                          <td className="px-2 py-1 font-medium text-blue-700">{d.wbs_code}</td>
                          <td className="px-2 py-1" title={d.nota}>
                            {d.title}
                          </td>
                          <td className="tabular px-2 py-1 text-right">
                            {m(num(d.pintado_actual))}
                          </td>
                          <td className="tabular px-2 py-1 text-right">
                            {d.estado === "sin_fecha" ? "—" : m(num(d.pintado_nuevo))}
                          </td>
                          <td
                            className={`tabular px-2 py-1 text-right ${
                              num(d.diferencia) < 0 ? "text-red-600" : "text-emerald-700"
                            }`}
                          >
                            {d.estado === "sin_fecha" ? "—" : m(num(d.diferencia))}
                          </td>
                          <td className="px-2 py-1 text-slate-500">
                            {d.estado === "sin_fecha" ? "no date — left alone" : "rebuilt"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setHistOpen(false)}
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={hist.data.a_reconstruir === 0 || histApply.isPending}
                    onClick={async () => {
                      await histApply.mutateAsync(undefined);
                      setHistOpen(false);
                    }}
                    className="rounded bg-amber-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {histApply.isPending
                      ? "Applying…"
                      : `Apply to ${hist.data.a_reconstruir} line(s)`}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
