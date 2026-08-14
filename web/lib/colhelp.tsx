"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Explicación corta de cada columna calculada (misma redacción en los 3 tabs).
// Formato: título con la fórmula + qué significa el saldo.
export const COL_HELP: Record<string, ReactNode> = {
  orig: (
    <>
      <b>Original budget</b> for the line, before changes.
    </>
  ),
  changes: (
    <>
      <b>Adjustments</b> to the original budget (approved increases or reductions).
    </>
  ),
  revised: (
    <>
      <b>Current budget.</b>
      <br />= Orig. Budget + Changes.
    </>
  ),
  spend: (
    <>
      <b>Actual spend</b> to date (sum of the Ledger payments to this line).
    </>
  ),
  remaining: (
    <>
      <b>What is left of the budget.</b>
      <br />= Revised − Spend.
      <br />
      Negative (red) = overdrawn.
    </>
  ),
  pct: (
    <>
      <b>Execution progress.</b>
      <br />= Spend ÷ Revised.
    </>
  ),
  forecast: (
    <>
      <b>Projected total spend</b> at close = Spend + what remains to be spent in future draws.
    </>
  ),
  overunder: (
    <>
      <b>Forecast variance vs budget.</b>
      <br />= Forecast − Revised.
      <br />
      Positive (red) = you will go over; negative = under.
    </>
  ),
  funding: (
    <>
      <b>What remains to be funded.</b>
      <br />= Forecast − Spend to date.
    </>
  ),
  tltotal: (
    <>
      <b>Timeline Total:</b> sum of everything distributed across the calendar (weeks / months) for
      this line.
    </>
  ),
  control: (
    <>
      <b>Reconciliation check.</b>
      <br />= Forecast − Timeline Total.
      <br />✓ = the full forecast is already spread over time. A <b>balance</b> = that amount still
      needs to be distributed to some week (or, if negative, you distributed too much).
    </>
  ),
  fullyear: (
    <>
      <b>Year total:</b> sum of all weeks / months of the selected year for this line.
    </>
  ),
};

// Encabezado de columna con explicación al hacer click: muestra un popover con
// la fórmula y qué significa. Usa portal + posición fija para no ser recortado
// por el scroll horizontal de la tabla. Reutilizable en Timeline / Detail / Job Cost.
export function ColHead({
  label,
  help,
  className,
  style,
  align = "left",
  rowSpan,
}: {
  label: ReactNode;
  help: ReactNode;
  className?: string;
  style?: CSSProperties;
  align?: "left" | "right" | "center";
  rowSpan?: number;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pos]);

  const toggle = () => {
    if (pos) {
      setPos(null);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const w = 248;
      setPos({ x: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)), y: r.bottom + 4 });
    }
  };

  const justify =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";

  return (
    <th className={className} style={style} rowSpan={rowSpan}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className={`flex w-full items-center gap-1 ${justify} cursor-help text-inherit`}
        title="Click: how it is calculated"
      >
        <span>{label}</span>
        <span className="text-[9px] opacity-60">ⓘ</span>
      </button>
      {pos &&
        createPortal(
          <>
            <button
              type="button"
              aria-label="Close"
              className="fixed inset-0 z-[9998] cursor-default"
              onClick={() => setPos(null)}
            />
            <div
              className="fixed z-[9999] w-62 rounded-md border border-slate-200 bg-white p-2.5 text-left font-normal text-[11px] leading-snug text-slate-700 normal-case shadow-xl"
              style={{ left: pos.x, top: pos.y, width: 248 }}
            >
              {help}
            </div>
          </>,
          document.body,
        )}
    </th>
  );
}
