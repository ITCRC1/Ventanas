/** El vocabulario visual de las tablas de pagos.
 *
 * Owner, 2026-11-10, sobre la pestaña Payments: *«necesito que se vean
 * mejor..quizas mas finas. mejor terminacion. mas compacto»*; y sobre la vista
 * de Disbursements: *«aca se bien»*.
 *
 * O sea: Disbursements es el patrón y Payments se trae a ese patrón. Las clases
 * viven acá —y no copiadas en cada componente— porque dos copias se separan sin
 * que nadie lo note, y era exactamente lo que había pasado: la misma tabla con
 * `text-xs` en una pantalla y `text-sm` en la otra.
 */

/** Botón de acción del encabezado. Se combina con el color que le toca:
 *  esmeralda = PDF, índigo = Excel, ámbar = reabrir, pizarra = neutro. */
export const BTN = "rounded-md border px-3 py-1.5 text-xs font-medium transition";

export const BTN_PDF = `${BTN} border-emerald-600 text-emerald-700 hover:bg-emerald-50`;
export const BTN_EXCEL = `${BTN} border-indigo-600 text-indigo-700 hover:bg-indigo-50`;
export const BTN_REABRIR = `${BTN} border-amber-500 text-amber-700 hover:bg-amber-50`;
export const BTN_NEUTRO = `${BTN} border-slate-300 bg-white text-slate-700 hover:bg-slate-100`;

/** Encabezado de columna: versalita fina, sin el gris pesado de antes. */
export const TH = "px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500";

/** Celda editable. Es el tamaño que el owner aprobó: `text-sm`, no `text-xs`. */
export const CELL = "w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-sm";

/** Marco de la tabla y sus filas. */
export const TABLA = "overflow-x-auto rounded-md border border-slate-200";
export const THEAD = "border-b border-slate-200 bg-slate-100 text-left";
export const TBODY = "divide-y divide-slate-100";
export const FILA = "hover:bg-slate-50/60";
export const TFOOT = "border-t-2 border-slate-300 bg-slate-50 font-semibold";

/** Encabezado claro de una tanda: reemplaza la barra negra que tenía Payments. */
export const CABECERA =
  "flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3";

/* ── El estado de una tanda ──────────────────────────────────────────────── */

/** ⚠️ Estaba copiado en Payments y en Disbursements con los MISMOS textos. Una
 *  sola copia: si mañana se renombra un estado, se renombra en los dos lados. */
export const ESTADO_ROTULO: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted to corporate",
  approved: "Approved",
  funded: "Wire received",
  transferred: "Transferred to LAFISE",
  settled: "Settled",
  cancelled: "Cancelled",
};

const ESTADO_COLOR: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 ring-slate-200",
  submitted: "bg-amber-50 text-amber-700 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  funded: "bg-sky-50 text-sky-700 ring-sky-200",
  transferred: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  settled: "bg-slate-100 text-slate-600 ring-slate-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
};

export function rotuloEstado(status: string): string {
  return ESTADO_ROTULO[status] ?? status;
}

/** Las clases del chip de estado. Un estado desconocido cae en el de borrador
 *  en vez de quedar sin color: una píldora invisible se lee como «sin estado». */
export function chipEstado(status: string): string {
  return `rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
    ESTADO_COLOR[status] ?? ESTADO_COLOR.draft
  }`;
}
