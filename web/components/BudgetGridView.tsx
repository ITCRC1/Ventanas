"use client";

/**
 * Budget grid — two years side by side, editable like a spreadsheet.
 *
 * Owner, 2026-11-09, looking at the «Budget 2027 — vs 2026» sheet: *«debés crear
 * este tab para yo poder editar con el side to side; debe ser también fácil de
 * editar como una hoja de Excel»*.
 *
 * El Excel ya mostraba los dos años juntos pero no se podía editar, y el Job
 * Cost se edita pero no pone el año anterior al lado. Esta pantalla es las dos
 * cosas: se escribe en el año que se presupuesta y el anterior queda a la
 * derecha, de solo lectura, para saber contra qué se está comparando.
 *
 * ⚠️ **La regla de reparto es la MISMA del Job Cost** (`commitColumn`): un monto
 * mensual se divide parejo entre las semanas de ese mes y el sobrante va en la
 * última. No se reimplementa distinto a propósito — si las dos pantallas
 * repartieran distinto, el mismo número daría dos cronogramas y nadie sabría
 * cuál vale.
 *
 * ⚠️ Las semanas anteriores al corte del Forecast son HISTORIA del LEDGER y no
 * se tocan. Un mes que cae entero antes del corte sale bloqueado; el año
 * anterior, completo, siempre es de lectura.
 *
 * Lo escrito queda en ámbar hasta que se aprieta Guardar. Se guarda en un solo
 * lote, como en el Job Cost: escribir cuarenta celdas no son cuarenta viajes.
 */

import { Fragment, useMemo, useRef, useState } from "react";

import { evalMath } from "@/lib/calc";
import {
  useCutoff,
  useFinancials,
  useScheduleCells,
  useScheduleWeeks,
  useTaskStates,
  useUpsertCells,
} from "@/lib/hooks";
import type { WbsFinancials } from "@/lib/types";

const MES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

type Pend = { wbs_id: number; week_start: string; planned_amount: number | null; state_id?: number };

function usd(n: number): string {
  if (!n) return "";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

const seccionDe = (code: string): string => (code || "").split(".")[0];

export function BudgetGridView() {
  const ahora = new Date().getFullYear();
  const [anio, setAnio] = useState(ahora + 1);
  const base = anio - 1;

  const fin = useFinancials();
  const celdas = useScheduleCells();
  const corte = useCutoff();
  const semanas = useScheduleWeeks();
  const estados = useTaskStates();
  const guardar = useUpsertCells();

  // Lo escrito y todavía sin guardar, por celda semanal.
  const [pend, setPend] = useState<Map<string, Pend>>(new Map());
  const [sel, setSel] = useState<{ wbs: number; mes: number } | null>(null);
  const [buf, setBuf] = useState<string | null>(null);
  const cajaRef = useRef<HTMLInputElement | null>(null);

  const cutoff = corte.data?.cutoff_date ?? "";
  const primerEstado = estados.data?.[0]?.id ?? 1;

  // ⚠️ Las semanas salen de `/schedule/weeks`, la MISMA lista que arma las
  // columnas del Job Cost. Derivarlas acá por mi cuenta era la trampa: si mi
  // lunes no fuera exactamente el suyo, un monto escrito en esta pantalla
  // caería en semanas que el Job Cost no mira en ese mes, y la misma cifra
  // daría dos cronogramas sin que nada avisara.
  const semanasDe = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const w of semanas.data?.weeks ?? []) {
      const k = w.slice(0, 7);
      const a = m.get(k);
      if (a) a.push(w);
      else m.set(k, [w]);
    }
    return m;
  }, [semanas.data]);

  // Monto por línea y semana, con lo pendiente ya aplicado encima.
  const monto = useMemo(() => {
    const m = new Map<number, Map<string, number>>();
    for (const c of celdas.data ?? []) {
      const f = m.get(c.wbs_id) ?? new Map<string, number>();
      f.set(c.week_start, Number(c.planned_amount) || 0);
      m.set(c.wbs_id, f);
    }
    for (const p of pend.values()) {
      const f = m.get(p.wbs_id) ?? new Map<string, number>();
      f.set(p.week_start, p.planned_amount ?? 0);
      m.set(p.wbs_id, f);
    }
    return m;
  }, [celdas.data, pend]);

  const total = (wbs: number, y: number, mes: number): number => {
    const ws = semanasDe.get(`${y}-${String(mes).padStart(2, "0")}`) ?? [];
    const f = monto.get(wbs);
    return ws.reduce((s, w) => s + (f?.get(w) ?? 0), 0);
  };
  const anual = (wbs: number, y: number): number =>
    Array.from({ length: 12 }, (_, i) => total(wbs, y, i + 1)).reduce((a, b) => a + b, 0);

  /** ¿Ese mes es historia del LEDGER? Entonces no se toca. */
  const bloqueado = (mes: number): boolean => {
    if (!cutoff) return false;
    const ws = semanasDe.get(`${anio}-${String(mes).padStart(2, "0")}`) ?? [];
    return ws.length > 0 && ws.every((w) => w < cutoff);
  };

  const lineas = useMemo(
    () =>
      (fin.data ?? [])
        .filter((r) => r.kind !== "section_header" && r.kind !== "proceeds")
        .sort((a, b) => {
          const sa = Number(seccionDe(a.wbs_code)) || 0;
          const sb = Number(seccionDe(b.wbs_code)) || 0;
          return sa - sb || a.wbs_code.localeCompare(b.wbs_code, undefined, { numeric: true });
        }),
    [fin.data],
  );
  const titulos = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of fin.data ?? []) if (/^\d+$/.test(r.wbs_code)) m.set(r.wbs_code, r.title);
    return m;
  }, [fin.data]);

  const grupos = useMemo(() => {
    const m = new Map<string, WbsFinancials[]>();
    for (const l of lineas) {
      const s = seccionDe(l.wbs_code);
      const a = m.get(s);
      if (a) a.push(l);
      else m.set(s, [l]);
    }
    return [...m.entries()];
  }, [lineas]);

  /** Escribe un mes: reparte entre sus semanas, igual que el Job Cost. */
  function anotarMes(wbs: number, mes: number, texto: string) {
    const ws = semanasDe.get(`${anio}-${String(mes).padStart(2, "0")}`) ?? [];
    if (ws.length === 0) return;
    const actual = total(wbs, anio, mes);
    const t = texto.trim();
    const nuevo = new Map(pend);
    const poner = (w: string, v: number | null) =>
      nuevo.set(`${wbs}|${w}`, {
        wbs_id: wbs,
        week_start: w,
        planned_amount: v,
        state_id: v === null ? undefined : primerEstado,
      });

    if (t === "") {
      if (Math.abs(actual) > 0.005) ws.forEach((w) => poner(w, null));
      setPend(nuevo);
      return;
    }
    const val = evalMath(t) ?? Number(t.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(val)) return;
    if (Math.abs(actual - val) < 0.005) return;
    if (ws.length === 1) poner(ws[0], val);
    else {
      // Parejo entre las semanas; el sobrante del redondeo, en la última.
      const per = Math.round((val / ws.length) * 100) / 100;
      ws.forEach((w, i) =>
        poner(w, i === ws.length - 1 ? Math.round((val - per * (ws.length - 1)) * 100) / 100 : per),
      );
    }
    setPend(nuevo);
  }

  /** Pegar desde Excel: una fila de meses, o un bloque de varias líneas. */
  function pegar(wbs0: number, mes0: number, texto: string) {
    const filas = texto.replace(/\r/g, "").replace(/\n$/, "").split("\n");
    const orden = lineas.map((l) => l.id);
    const i0 = orden.indexOf(wbs0);
    if (i0 < 0) return;
    filas.forEach((fila, df) => {
      const wbs = orden[i0 + df];
      if (wbs == null) return;
      fila.split("\t").forEach((celda, dc) => {
        const mes = mes0 + dc;
        if (mes > 12 || bloqueado(mes)) return;
        anotarMes(wbs, mes, celda);
      });
    });
  }

  if (fin.isLoading || celdas.isLoading || semanas.isLoading)
    return <p className="text-sm text-slate-500">Loading the grid…</p>;

  const pendientes = pend.size;
  const anioTot = (y: number) => lineas.reduce((s, l) => s + anual(l.id, y), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2">
        <label className="flex items-center gap-2 text-xs font-semibold text-teal-900">
          Year
          <select
            value={anio}
            onChange={(e) => {
              if (pendientes && !window.confirm("You have unsaved edits. Discard them?")) return;
              setPend(new Map());
              setAnio(Number(e.target.value));
            }}
            className="rounded border border-teal-300 bg-white px-2 py-1 text-sm font-bold text-teal-900"
          >
            {[ahora, ahora + 1, ahora + 2, ahora + 3].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[11px] text-teal-800">
          editing <b>{anio}</b> · <b>{base}</b> read-only beside it
        </span>
        <span className="ml-auto flex items-center gap-2">
          {pendientes ? (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              {pendientes} unsaved cell{pendientes === 1 ? "" : "s"}
            </span>
          ) : null}
          <button
            type="button"
            disabled={!pendientes || guardar.isPending}
            onClick={async () => {
              await guardar.mutateAsync([...pend.values()]);
              setPend(new Map());
            }}
            className="rounded bg-[#2d3a5c] px-3 py-1 text-xs font-semibold text-white hover:bg-[#3d4a6c] disabled:opacity-40"
          >
            {guardar.isPending ? "Saving…" : "💾 Save"}
          </button>
          <button
            type="button"
            disabled={!pendientes}
            onClick={() => setPend(new Map())}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 disabled:opacity-40"
          >
            Discard
          </button>
        </span>
      </div>

      <p className="text-[11px] text-slate-500">
        Type a monthly total and it spreads across that month&apos;s weeks, the same rule the Job
        Cost uses. Math works (<code>1000+500</code>, <code>=46500/3</code>). Enter, Tab and arrows
        move; paste a block straight from Excel. Months entirely before the Forecast cut-off
        {cutoff ? ` (${cutoff})` : ""} are history from the LEDGER and are locked.
      </p>

      <div className="max-h-[66vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="border-collapse text-[11px]">
          <thead className="sticky top-0 z-20">
            <tr className="bg-[#0F5F59] text-white">
              <th className="sticky left-0 z-30 bg-[#0F5F59] px-2 py-1 text-left">WBS</th>
              <th className="sticky left-[70px] z-30 bg-[#0F5F59] px-2 py-1 text-left">Task</th>
              {MES.map((m, i) => (
                <th
                  key={m}
                  colSpan={2}
                  className={`border-l border-white/30 px-1 py-1 text-center ${
                    bloqueado(i + 1) ? "text-white/50" : ""
                  }`}
                >
                  {m}
                  {bloqueado(i + 1) ? " 🔒" : ""}
                </th>
              ))}
              <th className="bg-[#8A5A00] px-2 py-1 text-right">TOTAL {anio}</th>
              <th className="bg-[#8A5A00] px-2 py-1 text-right">TOTAL {base}</th>
              <th className="bg-[#8A5A00] px-2 py-1 text-right">VAR</th>
            </tr>
            <tr className="bg-[#1F4E79] text-white">
              <th className="sticky left-0 z-30 bg-[#1F4E79]" />
              <th className="sticky left-[70px] z-30 bg-[#1F4E79]" />
              {MES.map((m) => (
                <Fragment key={m}>
                  <th className="border-l border-white/30 px-1 text-right text-[10px]">{anio}</th>
                  <th className="px-1 text-right text-[10px] text-white/60">{base}</th>
                </Fragment>
              ))}
              <th colSpan={3} className="bg-[#8A5A00]" />
            </tr>
          </thead>
          <tbody>
            {grupos.map(([sec, ls]) => (
              <Fragment key={sec}>
                <tr className="bg-[#EAF0FA]">
                  <td colSpan={5 + 24} className="px-2 py-1 font-semibold text-teal-900">
                    {sec} {(titulos.get(sec) ?? "").toUpperCase()}
                  </td>
                </tr>
                {ls.map((l) => {
                  const ta = anual(l.id, anio);
                  const tb = anual(l.id, base);
                  return (
                    <tr key={l.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="sticky left-0 z-10 bg-white px-2 font-mono text-[10px]">
                        {l.wbs_code}
                      </td>
                      <td className="sticky left-[70px] z-10 whitespace-nowrap bg-white px-2">
                        {l.title}
                      </td>
                      {MES.map((m, i) => {
                        const mes = i + 1;
                        const v = total(l.id, anio, mes);
                        const vb = total(l.id, base, mes);
                        const lock = bloqueado(mes);
                        const ws = semanasDe.get(`${anio}-${String(mes).padStart(2, "0")}`) ?? [];
                        const sucia = ws.some((w) => pend.has(`${l.id}|${w}`));
                        const activa = sel?.wbs === l.id && sel?.mes === mes;
                        return (
                          <Fragment key={m}>
                            <td
                              className={`border-l border-slate-200 p-0 text-right ${
                                lock ? "bg-slate-100 text-slate-400" : ""
                              } ${sucia ? "bg-amber-100 ring-1 ring-inset ring-amber-500" : ""}`}
                            >
                              {activa && buf !== null ? (
                                <input
                                  ref={cajaRef}
                                  autoFocus
                                  value={buf}
                                  onChange={(e) => setBuf(e.target.value)}
                                  onPaste={(e) => {
                                    const txt = e.clipboardData.getData("text");
                                    if (txt.includes("\t") || txt.includes("\n")) {
                                      e.preventDefault();
                                      pegar(l.id, mes, txt);
                                      setBuf(null);
                                      setSel(null);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    const mover = (dm: number, dl: number) => {
                                      anotarMes(l.id, mes, buf);
                                      const orden = lineas.map((x) => x.id);
                                      const i2 = orden.indexOf(l.id) + dl;
                                      const m2 = mes + dm;
                                      setBuf(null);
                                      if (m2 >= 1 && m2 <= 12 && orden[i2] != null)
                                        setSel({ wbs: orden[i2], mes: m2 });
                                      else setSel(null);
                                    };
                                    if (e.key === "Enter" || e.key === "ArrowDown") {
                                      e.preventDefault();
                                      mover(0, 1);
                                    } else if (e.key === "Tab" || e.key === "ArrowRight") {
                                      e.preventDefault();
                                      mover(1, 0);
                                    } else if (e.key === "ArrowLeft") {
                                      e.preventDefault();
                                      mover(-1, 0);
                                    } else if (e.key === "ArrowUp") {
                                      e.preventDefault();
                                      mover(0, -1);
                                    } else if (e.key === "Escape") {
                                      setBuf(null);
                                      setSel(null);
                                    }
                                  }}
                                  onBlur={() => {
                                    anotarMes(l.id, mes, buf);
                                    setBuf(null);
                                  }}
                                  className="w-[86px] bg-white px-1 py-0.5 text-right text-[11px] outline-none ring-2 ring-inset ring-[#2962FF]"
                                />
                              ) : (
                                <button
                                  type="button"
                                  disabled={lock}
                                  onClick={() => {
                                    if (lock) return;
                                    setSel({ wbs: l.id, mes });
                                    setBuf(v ? String(v) : "");
                                  }}
                                  className="tabular w-[86px] px-1 py-0.5 text-right disabled:cursor-not-allowed"
                                  title={lock ? "History from the LEDGER — locked" : undefined}
                                >
                                  {usd(v)}
                                </button>
                              )}
                            </td>
                            <td className="tabular bg-slate-50/70 px-1 text-right text-[10px] text-slate-500">
                              {usd(vb)}
                            </td>
                          </Fragment>
                        );
                      })}
                      <td className="tabular bg-amber-50 px-2 text-right font-bold">{usd(ta)}</td>
                      <td className="tabular bg-amber-50/50 px-2 text-right text-slate-500">
                        {usd(tb)}
                      </td>
                      <td
                        className={`tabular bg-amber-50/50 px-2 text-right ${
                          ta - tb > 0 ? "text-red-700" : "text-emerald-700"
                        }`}
                      >
                        {usd(ta - tb)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-[#DCE6F4] font-semibold">
                  <td className="sticky left-0 z-10 bg-[#DCE6F4] px-2" />
                  <td className="sticky left-[70px] z-10 whitespace-nowrap bg-[#DCE6F4] px-2">
                    Subtotal {sec}
                  </td>
                  {MES.map((m, i) => (
                    <Fragment key={m}>
                      <td className="tabular border-l border-slate-300 px-1 text-right">
                        {usd(ls.reduce((s, l) => s + total(l.id, anio, i + 1), 0))}
                      </td>
                      <td className="tabular px-1 text-right text-[10px] text-slate-500">
                        {usd(ls.reduce((s, l) => s + total(l.id, base, i + 1), 0))}
                      </td>
                    </Fragment>
                  ))}
                  <td className="tabular px-2 text-right">
                    {usd(ls.reduce((s, l) => s + anual(l.id, anio), 0))}
                  </td>
                  <td className="tabular px-2 text-right text-slate-500">
                    {usd(ls.reduce((s, l) => s + anual(l.id, base), 0))}
                  </td>
                  <td className="tabular px-2 text-right">
                    {usd(ls.reduce((s, l) => s + anual(l.id, anio) - anual(l.id, base), 0))}
                  </td>
                </tr>
              </Fragment>
            ))}
            <tr className="bg-[#0F5F59] font-bold text-white">
              <td className="sticky left-0 z-10 bg-[#0F5F59] px-2" />
              <td className="sticky left-[70px] z-10 whitespace-nowrap bg-[#0F5F59] px-2">
                PROJECT TOTAL
              </td>
              {MES.map((m, i) => (
                <Fragment key={m}>
                  <td className="tabular border-l border-white/30 px-1 text-right">
                    {usd(lineas.reduce((s, l) => s + total(l.id, anio, i + 1), 0))}
                  </td>
                  <td className="tabular px-1 text-right text-[10px] text-white/70">
                    {usd(lineas.reduce((s, l) => s + total(l.id, base, i + 1), 0))}
                  </td>
                </Fragment>
              ))}
              <td className="tabular px-2 text-right">{usd(anioTot(anio))}</td>
              <td className="tabular px-2 text-right text-white/70">{usd(anioTot(base))}</td>
              <td className="tabular px-2 text-right">{usd(anioTot(anio) - anioTot(base))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
