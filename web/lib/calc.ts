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
