/**
 * La SECCIÓN del WBS: el único lugar donde se decide cómo se agrupa el proyecto.
 *
 * Owner, 2026-11-09: *«todo el app debe estar estandarizado a estos grupos de
 * la misma manera»*.
 *
 * El proyecto tiene once secciones, 0 a 10, y el número sale del `wbs_code`:
 * lo que está antes del primer punto. El nombre sale de la fila cuyo código es
 * ese número pelado — «0» → «Property Holding Expenses».
 *
 * ## Por qué esto vive en un solo archivo
 *
 * Antes cada pantalla agrupaba a su manera: el Job Cost por sección, el Budget
 * Proposal / Timeline / Planning / Schedule / Dashboard por `category`, y el
 * Timeline además **numeraba sus categorías 1..8**, lo que las hacía parecer
 * secciones del WBS sin serlo — «6 OVERHEAD» en el Timeline no es la sección 6,
 * que es Property Sale. Ocho grupos de un lado, once del otro, con números que
 * se pisaban: saltar entre tabs obligaba a recomponer el mapa de cabeza.
 *
 * ⚠️ Que cada vista derive la sección por su cuenta es como se llega a que una
 * lo haga con `split('.')` y otra con un regex, y un código raro caiga en
 * grupos distintos según la pantalla. Por eso `seccionDe` se importa; no se
 * reescribe.
 */

/** El número de sección de un código de WBS. `"3.2.1"` → `"3"`.
 *
 *  ⚠️ Devuelve texto, no número: hay códigos de WBS que NO son numéricos
 *  —`Blue`, `Green`, `Other Items`, `Project Estimate:`—. Son la leyenda del
 *  Job Cost guardada como filas de WBS, con presupuesto 0. Convertirlos a
 *  entero revienta (`invalid input syntax for integer`), así que acá se tratan
 *  como una sección más y el orden los manda al final. */
export const seccionDe = (wbsCode: string | null | undefined): string =>
  String(wbsCode ?? "").split(".")[0];

/** `true` si el código ES una fila de sección (`"0"`, `"10"`), no una línea. */
export const esSeccion = (wbsCode: string | null | undefined): boolean =>
  /^\d+$/.test(String(wbsCode ?? ""));

/** El título de cada sección, sacado de las filas cuyo código es un número.
 *  Se le pasa la lista completa de WBS (incluidos los encabezados). */
export function titulosDeSeccion(
  filas: { wbs_code: string; title: string }[] | undefined | null,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of filas ?? []) if (esSeccion(r.wbs_code)) m.set(r.wbs_code, r.title);
  return m;
}

/** Cómo se rotula una sección en pantalla: `"0 PROPERTY HOLDING EXPENSES"`. */
export function rotuloSeccion(sec: string, titulos: Map<string, string>): string {
  const t = titulos.get(sec);
  return (t ? `${sec} ${t}` : sec).toUpperCase();
}

/** El orden de las secciones: 0, 1, 2 … 10, y lo no numérico al final.
 *
 *  ⚠️ Numérico y no alfabético: ordenar texto pone «10» entre «1» y «2», que es
 *  como el Job Cost terminaría mostrando Construction en el tercer lugar. */
export function compararSeccion(a: string, b: string): number {
  const na = /^\d+$/.test(a) ? Number(a) : Number.POSITIVE_INFINITY;
  const nb = /^\d+$/.test(b) ? Number(b) : Number.POSITIVE_INFINITY;
  return na - nb || a.localeCompare(b);
}

/** Agrupa cualquier lista de líneas por sección, ya ordenada.
 *
 *  Conserva el orden en que venían las líneas DENTRO de cada sección — que es
 *  el `sort_order` del WBS tal como lo manda la API — y ordena las secciones
 *  entre sí por su número. */
export function agruparPorSeccion<T extends { wbs_code: string }>(
  filas: T[] | undefined | null,
): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const f of filas ?? []) {
    const s = seccionDe(f.wbs_code);
    const a = m.get(s);
    if (a) a.push(f);
    else m.set(s, [f]);
  }
  return [...m.entries()].sort((x, y) => compararSeccion(x[0], y[0]));
}
