// Formato dolarizado, estilo del Job Cost Report.
const usd = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function money(value: string | number | null): string {
  if (value === null || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n)) return "—";
  if (n === 0) return "—";
  return n < 0 ? `(${usd.format(Math.abs(n))})` : usd.format(n);
}

// Como money() pero con signo $ (negativos entre paréntesis). Para tablas donde
// el owner pidió ver el símbolo de moneda.
export function moneyUsd(value: string | number | null): string {
  if (value === null || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(n) || n === 0) return "—";
  return n < 0 ? `($${usd.format(Math.abs(n))})` : `$${usd.format(n)}`;
}

// Monto con $ y DOS decimales. Es el formato de las tandas de pago: ahí cada
// centavo es una instrucción al banco, así que no se redondea como en el Job
// Cost. Negativos entre paréntesis, al estilo contable.
export function usd2(value: string | number | null): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (Number.isNaN(n)) return "";
  const s = `$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return n < 0 ? `(${s})` : s;
}

/** Deja solo lo que puede ser un número: para volver de «$14,125.00» a «14125.00». */
export function rawNum(value: string): string {
  return value.replace(/[^0-9.-]/g, "");
}

export function isNegative(value: string | number | null): boolean {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return !Number.isNaN(n) && n < 0;
}

export function num(value: string | number | null): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isNaN(n) ? 0 : n;
}

export function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

// Compacto para ejes de gráficas: 1.2M, 340k
export function compactMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(n / 1000).toFixed(2)}K`;
  return `$${Math.round(n)}`;
}
