// Agregación del cronograma: semanas -> meses -> trimestres.
// La semana es la base editable; mes y trimestre son sumas (como los subtotales
// del Job Cost Report en el Excel). Cero recálculo de negocio: sólo presentación.

export type View = "week" | "month" | "quarter";

export interface Column {
  key: string; // identificador de la columna
  label: string; // etiqueta corta visible
  sub: string; // año / trimestre para la fila superior
  weeks: string[]; // semanas ISO que agrupa (en week view, una sola)
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_UP = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

// --- Vista consolidada de UN año (Q → Mes → Semana, como el Excel) ---------

// Años presentes en las semanas (para el selector de año).
export function yearsOf(weeks: string[]): number[] {
  const set = new Set<number>();
  for (const w of weeks) set.add(Number(w.slice(0, 4)));
  return [...set].sort((a, b) => a - b);
}

// Día del mes de una columna semanal (fila inferior de la cabecera).
export function weekDay(col: Column): string {
  const w = col.weeks[0];
  if (!w) return "";
  return String(new Date(`${w}T00:00:00`).getUTCDate());
}

export interface Band {
  key: string;
  label: string;
  span: number; // cuántas columnas semanales abarca
}

// Agrupa CUALQUIER conjunto de columnas por trimestre o por mes (para la cabecera
// anidada). Sirve para vista semanal, mensual o trimestral.
export function colBands(columns: Column[], level: "quarter" | "month"): Band[] {
  // Si hay más de un año, la etiqueta lleva el año ("Q1 '24") para no confundir.
  const years = new Set(columns.map((c) => (c.weeks[0] ?? "").slice(0, 4)).filter(Boolean));
  const multi = years.size > 1;
  const out: Band[] = [];
  for (const c of columns) {
    const w = c.weeks[0];
    if (!w) continue;
    const d = new Date(`${w}T00:00:00`);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const q = Math.floor(m / 3) + 1;
    const key = level === "quarter" ? `${y}-q${q}` : `${y}-m${m}`;
    const base = level === "quarter" ? `Q${q}` : MONTHS_UP[m];
    const label = multi ? `${base} '${String(y).slice(2)}` : base;
    const last = out[out.length - 1];
    if (last && last.key === key) last.span += 1;
    else out.push({ key, label, span: 1 });
  }
  return out;
}

// Cabecera anidada de la vista semanal de un año: agrupa las columnas SEMANALES
// por trimestre (Q1..Q4) y por mes (ENE..DIC). weekCols = buildColumns(weeks,"week").
export function weekBands(weekCols: Column[]): { quarters: Band[]; months: Band[] } {
  const years = new Set(weekCols.map((c) => (c.weeks[0] ?? "").slice(0, 4)).filter(Boolean));
  const multi = years.size > 1;
  const quarters: Band[] = [];
  const months: Band[] = [];
  for (const c of weekCols) {
    const w = c.weeks[0];
    if (!w) continue;
    const d = new Date(`${w}T00:00:00`);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const q = Math.floor(m / 3) + 1;
    const yy = String(y).slice(2);
    const lm = months[months.length - 1];
    const mKey = `${y}-m${m}`;
    if (lm && lm.key === mKey) lm.span += 1;
    else
      months.push({ key: mKey, label: multi ? `${MONTHS_UP[m]} '${yy}` : MONTHS_UP[m], span: 1 });
    const lq = quarters[quarters.length - 1];
    const qKey = `${y}-q${q}`;
    if (lq && lq.key === qKey) lq.span += 1;
    else quarters.push({ key: qKey, label: multi ? `Q${q} '${yy}` : `Q${q}`, span: 1 });
  }
  return { quarters, months };
}

export function buildColumns(weeks: string[], view: View): Column[] {
  if (view === "week") {
    return weeks.map((w) => {
      const d = new Date(`${w}T00:00:00`);
      return {
        key: w,
        label: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
        sub: String(d.getUTCFullYear()),
        weeks: [w],
      };
    });
  }
  const buckets = new Map<string, { label: string; sub: string; weeks: string[] }>();
  for (const w of weeks) {
    const d = new Date(`${w}T00:00:00`);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const key = view === "month" ? `${y}-${m}` : `${y}-Q${Math.floor(m / 3) + 1}`;
    const label = view === "month" ? MONTHS[m] : `Q${Math.floor(m / 3) + 1}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.weeks.push(w);
    else buckets.set(key, { label, sub: String(y), weeks: [w] });
  }
  return [...buckets.entries()].map(([key, v]) => ({ key, ...v }));
}

// Cabecera superior de la matriz (nivel que agrupa las columnas de abajo):
//  - vista semana    → mes+año sobre los días
//  - vista mes       → trimestre+año sobre los meses
//  - vista trimestre → año sobre los trimestres
// Como todas las columnas tienen el mismo ancho, cada grupo se posiciona por
// índice (startIndex..startIndex+span). Son pocos grupos → no se virtualizan.
export interface TopGroup {
  key: string;
  label: string;
  startIndex: number;
  span: number;
}

export function topGroups(columns: Column[], view: View): TopGroup[] {
  const groups: TopGroup[] = [];
  for (let i = 0; i < columns.length; i++) {
    const w = columns[i].weeks[0];
    if (!w) continue;
    const d = new Date(`${w}T00:00:00`);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    let key: string;
    let label: string;
    if (view === "quarter") {
      key = `${y}`;
      label = `${y}`;
    } else if (view === "month") {
      const q = Math.floor(m / 3) + 1;
      key = `${y}-Q${q}`;
      label = `Q${q} ${y}`;
    } else {
      key = `${y}-${m}`;
      label = `${MONTHS[m]} ${y}`;
    }
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.span += 1;
    else groups.push({ key, label, startIndex: i, span: 1 });
  }
  return groups;
}

// Índice: cellsByWbs[wbs_id][weekISO] = { amount, state_id }
export type CellIndex = Map<number, Map<string, { amount: number | null; state_id: number }>>;

export function indexCells(
  cells: { wbs_id: number; week_start: string; planned_amount: string | null; state_id: number }[],
): CellIndex {
  const idx: CellIndex = new Map();
  for (const c of cells) {
    let row = idx.get(c.wbs_id);
    if (!row) {
      row = new Map();
      idx.set(c.wbs_id, row);
    }
    row.set(c.week_start, {
      amount: c.planned_amount === null ? null : Number(c.planned_amount),
      state_id: c.state_id,
    });
  }
  return idx;
}

// Suma planificada de un WBS sobre las semanas de una columna.
export function columnTotal(index: CellIndex, wbsId: number, weeks: string[]): number {
  const row = index.get(wbsId);
  if (!row) return 0;
  let total = 0;
  for (const w of weeks) {
    const cell = row.get(w);
    if (cell?.amount) total += cell.amount;
  }
  return total;
}
