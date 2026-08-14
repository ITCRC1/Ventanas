"use client";

// Herramienta de PINTAR compartida por Timeline, Timeline Detail y Job Cost.
// El COLOR es el del proyecto/categoría (elegible por el usuario, como el Excel).
// Pintar una celda de semana = marca su ejecución (guarda un schedule_cell,
// preservando el monto); al renderizar, una celda marcada se pinta del color de
// SU categoría. Todo va a la misma tabla → los 3 tabs muestran los mismos colores.

import { useQueryClient } from "@tanstack/react-query";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { useCategories, useMe, useTaskStates, useUpdateCategory } from "./hooks";
import type { ScheduleCell } from "./types";

const DEFAULT_BG = "#94a3b8"; // gris para categorías sin color elegido aún

// Aclara un color hex mezclándolo hacia blanco (ratio 0..1). Se usa para bajarle
// la intensidad al fondo de una celda que TIENE cifra, y así leer bien el número.
export function softenHex(hex: string, ratio = 0.5): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const mix = (c: number) => Math.round(c + (255 - c) * ratio);
  const r = mix(Number.parseInt(h.slice(0, 2), 16));
  const g = mix(Number.parseInt(h.slice(2, 4), 16));
  const b = mix(Number.parseInt(h.slice(4, 6), 16));
  return `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function usePaintTool() {
  const cats = useCategories();
  const states = useTaskStates();
  const me = useMe();
  const qc = useQueryClient();
  const setCatColor = useUpdateCategory();
  const canPaint = me.data?.permissions.includes("schedule.edit") ?? false;
  const canColor = me.data?.permissions.includes("wbs.edit") ?? false;

  const [paintOn, setPaintOn] = useState(false);
  const [brush, setBrush] = useState<"paint" | "erase">("paint");
  const painting = useRef(false);

  useEffect(() => {
    const up = () => {
      painting.current = false;
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // nombre de categoría → color / id / número de proyecto (sort_order, orden del Excel).
  const catColor = useMemo(
    () => new Map((cats.data ?? []).map((c) => [c.name, c.color_hex])),
    [cats.data],
  );
  const catId = useMemo(() => new Map((cats.data ?? []).map((c) => [c.name, c.id])), [cats.data]);
  const catOrder = useMemo(
    () => new Map((cats.data ?? []).map((c) => [c.name, c.sort_order])),
    [cats.data],
  );

  // Marca de "pintado": cualquier estado sirve; el color visible sale de la categoría.
  const markState = states.data?.[0]?.id ?? 1;

  // Pintado OPTIMISTA en tiempo real: actualiza el cache local al instante (la
  // celda se colorea ya) y persiste en segundo plano SIN refetch. El monto no
  // cambia → no hace falta invalidar ["wbs"] (el forecast no se mueve).
  const paintCell = (wbsId: number, week: string, amount: number | null) => {
    if (!paintOn) return;
    const erase = brush === "erase";
    // Borrar NUNCA elimina una semana con monto (es forecast real) → no se distorsiona.
    if (erase && amount != null) return;
    qc.setQueryData<ScheduleCell[]>(["schedule", "cells"], (old) => {
      const arr = old ?? [];
      if (erase) return arr.filter((c) => !(c.wbs_id === wbsId && c.week_start === week));
      const i = arr.findIndex((c) => c.wbs_id === wbsId && c.week_start === week);
      if (i >= 0) {
        const next = arr.slice();
        next[i] = { ...next[i], state_id: markState };
        return next;
      }
      return [
        ...arr,
        {
          wbs_id: wbsId,
          week_start: week,
          planned_amount: amount == null ? null : String(amount),
          state_id: markState,
          note: null,
        },
      ];
    });
    const done = erase
      ? api.del(`/schedule/cell?wbs_id=${wbsId}&week_start=${week}`)
      : api.put("/schedule/cell", {
          wbs_id: wbsId,
          week_start: week,
          planned_amount: amount,
          state_id: markState,
        });
    // Si el guardado falla, resincronizar con el servidor.
    void done.catch(() => qc.invalidateQueries({ queryKey: ["schedule", "cells"] }));
  };

  const cellPaint = (doPaint: () => void) =>
    paintOn
      ? {
          onMouseDown: (e: MouseEvent) => {
            e.preventDefault();
            painting.current = true;
            doPaint();
          },
          onMouseEnter: () => {
            if (painting.current) doPaint();
          },
        }
      : {};

  // Color de fondo de una celda: si está marcada (existe), el color de su categoría.
  const cellBg = (categoryName: string, exists: boolean): string | undefined =>
    exists ? (catColor.get(categoryName) ?? DEFAULT_BG) : undefined;

  const pickColor = (categoryName: string, hex: string) => {
    const id = catId.get(categoryName);
    if (id != null) setCatColor.mutate({ id, color_hex: hex });
  };

  return {
    canPaint,
    canColor,
    paintOn,
    setPaintOn,
    brush,
    setBrush,
    catColor,
    catOrder,
    cellBg,
    pickColor,
    paintCell,
    cellPaint,
  };
}

// Nombre de categoría sin el prefijo "N-" (ej. "0-Property Acquisition" → "Property Acquisition").
export function cleanCatName(name: string): string {
  // Quita solo prefijos con guion ("0-Property Acquisition" → "Property Acquisition").
  // NO toca nombres con punto decimal como "6.1 Overhead" (se muestran tal cual).
  return name.replace(/^\d+\s*-\s*/, "");
}

export type PaintTool = ReturnType<typeof usePaintTool>;

export function PaintToolbar({ tool }: { tool: PaintTool }) {
  if (!tool.canPaint) return null;
  // Apagado: un solo botón grande para empezar. Encendido: barra clara con
  // Colorear / Borrar y Terminar, con instrucción de clic o arrastre.
  if (!tool.paintOn) {
    return (
      <button
        type="button"
        onClick={() => {
          tool.setPaintOn(true);
          tool.setBrush("paint");
        }}
        className="ml-auto rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
        title="Mark execution by week with the project color"
      >
        🖌 Paint weeks
      </button>
    );
  }
  return (
    <div className="ml-auto flex flex-wrap items-center gap-2 rounded-lg border-2 border-amber-400 bg-amber-50 px-2.5 py-1.5">
      <span className="text-xs font-semibold text-amber-800">Click or drag over the weeks:</span>
      <button
        type="button"
        onClick={() => tool.setBrush("paint")}
        className={`rounded px-3 py-1 text-sm font-medium ${
          tool.brush === "paint"
            ? "bg-amber-600 text-white shadow"
            : "border border-amber-400 bg-white text-amber-800"
        }`}
      >
        🖌 Color
      </button>
      <button
        type="button"
        onClick={() => tool.setBrush("erase")}
        className={`rounded px-3 py-1 text-sm font-medium ${
          tool.brush === "erase"
            ? "bg-slate-800 text-white shadow"
            : "border border-slate-400 bg-white text-slate-700"
        }`}
      >
        🧽 Erase
      </button>
      <button
        type="button"
        onClick={() => tool.setPaintOn(false)}
        className="rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700"
      >
        ✓ Done
      </button>
    </div>
  );
}

// Encabezado del proyecto/categoría estilo Excel: bloque numerado de color +
// nombre + (si tiene permiso) selector de color.
export function CategoryHead({ tool, category }: { tool: PaintTool; category: string }) {
  const color = tool.catColor.get(category) ?? DEFAULT_BG;
  const num = tool.catOrder.get(category);
  return (
    <span className="inline-flex items-center gap-2 align-middle">
      <span
        className="flex h-5 min-w-[22px] items-center justify-center rounded px-1 text-[11px] font-bold text-white"
        style={{ backgroundColor: color }}
      >
        {num ?? "·"}
      </span>
      <span>{cleanCatName(category)}</span>
      {tool.canColor ? (
        <input
          type="color"
          value={color}
          onChange={(e) => tool.pickColor(category, e.target.value)}
          title="Project color"
          className="h-4 w-5 cursor-pointer rounded border border-slate-300 bg-transparent p-0 align-middle"
        />
      ) : null}
    </span>
  );
}
