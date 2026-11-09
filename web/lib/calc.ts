// Evalúa aritmética simple de forma SEGURA (sin eval / sin Function). Acepta
// + - * / ( ) y decimales; ignora $, comas y espacios; un "=" inicial es opcional.
// Devuelve el número resultante, o null si NO es una expresión válida (para que
// el que llama caiga al parseo simple o descarte). Recursivo-descendente.
export function evalMath(input: string): number | null {
  let s = (input ?? "").trim();
  if (s === "") return null;
  if (s.startsWith("=")) s = s.slice(1);
  s = s.replace(/[$,\s]/g, "");
  if (s === "" || !/^[0-9.+\-*/()]+$/.test(s)) return null;

  let i = 0;
  const peek = () => s[i];

  function factor(): number {
    if (peek() === "+") {
      i++;
      return factor();
    }
    if (peek() === "-") {
      i++;
      return -factor();
    }
    if (peek() === "(") {
      i++;
      const v = expr();
      if (peek() !== ")") throw new Error("paren");
      i++;
      return v;
    }
    const start = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    if (start === i) throw new Error("num");
    const n = Number(s.slice(start, i));
    if (Number.isNaN(n)) throw new Error("num");
    return n;
  }
  function term(): number {
    let v = factor();
    while (peek() === "*" || peek() === "/") {
      const op = s[i++];
      const r = factor();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function expr(): number {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = s[i++];
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  try {
    const v = expr();
    if (i !== s.length || !Number.isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Repartir un monto entre VARIOS MESES, escrito en la celda.
//
// Owner, 2026-11-09, parado sobre los $80,000 de Gravel Existing Roads en
// enero: *«tengo este numero en Enero $80,000.00 y quiero distribuirlo en
// algunos meses en forma lineal»* · *«como puedo ubicar un numero y dar una
// instruccion para poder mover datos en forma rapida»*.
//
// La grilla ya sabia repartir hacia ABAJO (un total mensual se abre en las
// semanas del mes). Esto es lo mismo hacia los LADOS.
//
// ⚠️ Antes de esto, escribir `80000>5` en una celda NO fallaba: `evalMath` lo
// rechazaba por el `>`, el que llamaba caia al parseo simple que borra todo lo
// que no sea digito, y quedaba escrito **800005**. Un numero creible, sin un
// solo error a la vista. Por eso el reparto se reconoce ANTES de parsear.
// ─────────────────────────────────────────────────────────────────────────────

/** Como se reparte: parejo, en rampa, al reves, o con el pico al medio. */
export type Curva = "flat" | "up" | "down" | "bell";

/** Un reparto pedido desde la celda. `monto === null` significa «lo que ya
 *  esta en esta celda»: asi `>5` reparte los 80,000 sin retipearlos. */
export type Reparto = { monto: number | null; meses: number; curva: Curva };

const MES3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/**
 * Lee una instruccion de reparto. Devuelve `null` si el texto NO es una —y
 * entonces el que llama sigue con lo de siempre, que es como esto convive con
 * los montos normales y la matematica sin pisarlos.
 *
 *   `80000>5`        80,000 en 5 meses desde este          16,000 c/u
 *   `>5`             lo que ya esta aca, en 5 meses
 *   `80000>may`      de este mes hasta mayo, inclusive
 *   `=240000/3>4`    la izquierda puede ser matematica
 *   `>5~up`          en rampa; tambien `~down` y `~bell`
 *
 * @param mesDesde 1-12, el mes de la celda donde se escribio.
 */
export function parseReparto(input: string, mesDesde: number): Reparto | null {
  const s = (input ?? "").trim();
  const corte = s.indexOf(">");
  if (corte < 0) return null;

  const izq = s.slice(0, corte).trim();
  let der = s.slice(corte + 1).trim();

  // La curva, si viene.
  let curva: Curva = "flat";
  const t = der.indexOf("~");
  if (t >= 0) {
    const c = der
      .slice(t + 1)
      .trim()
      .toLowerCase();
    if (c !== "up" && c !== "down" && c !== "bell") return null;
    curva = c;
    der = der.slice(0, t).trim();
  }
  if (der === "") return null;

  // A la derecha: una cantidad de meses, o el nombre del mes donde terminar.
  let meses: number;
  const mi = MES3.indexOf(der.toUpperCase().slice(0, 3));
  if (mi >= 0) {
    // Inclusive de las dos puntas: de ENE a MAY son cinco meses, no cuatro.
    meses = mi + 1 - mesDesde + 1;
    if (meses < 1) return null; // hacia atras no se reparte
  } else {
    if (!/^\d{1,2}$/.test(der)) return null;
    meses = Number(der);
    if (meses < 1 || meses > 12) return null;
  }

  const monto = izq === "" ? null : evalMath(izq);
  if (izq !== "" && (monto === null || !Number.isFinite(monto))) return null;
  return { monto, meses, curva };
}

/** El peso de cada mes segun la curva. `up` arranca liviano y sube; `bell`
 *  tiene el pico al medio. Una obra casi nunca gasta pareja. */
export function pesosCurva(n: number, curva: Curva): number[] {
  if (n <= 0) return [];
  if (curva === "up") return Array.from({ length: n }, (_, i) => i + 1);
  if (curva === "down") return Array.from({ length: n }, (_, i) => n - i);
  if (curva === "bell")
    return Array.from({ length: n }, (_, i) => (n + 1) / 2 - Math.abs(i - (n - 1) / 2));
  return Array.from({ length: n }, () => 1);
}

/**
 * Parte `total` segun los pesos, a dos decimales, y **el sobrante del redondeo
 * va en el ultimo**.
 *
 * ⚠️ Es a proposito la misma regla con la que la grilla abre un mes en sus
 * semanas. Si repartiera distinto, los doce meses no sumarian el total que se
 * escribio y la diferencia aparecaria como centavos sueltos que nadie podria
 * explicar.
 */
export function repartir(total: number, pesos: number[]): number[] {
  const suma = pesos.reduce((a, b) => a + b, 0);
  if (!suma) return pesos.map(() => 0);
  const r = pesos.map((p) => Math.round(((total * p) / suma) * 100) / 100);
  const dif = Math.round((total - r.reduce((a, b) => a + b, 0)) * 100) / 100;
  if (r.length) r[r.length - 1] = Math.round((r[r.length - 1] + dif) * 100) / 100;
  return r;
}
