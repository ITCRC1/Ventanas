"use client";

// Indicador de guardado de la barra de arriba. Vale para el tab que esté
// abierto, sea cual sea: el cliente HTTP reporta por su cuenta, así que ninguna
// vista tiene que acordarse de nada.
//
// ⚠️ Por qué. La app guarda campo por campo al salir del input, sin botón.
// Mientras todo contesta 200 eso se siente bien; cuando algo falla, no se
// siente nada. El 2026-11-07 la sesión se venció a media edición del
// desembolso #29.0 y se siguió escribiendo veinte minutos contra una API que
// contestaba 401 a todo. Se perdieron dos líneas.

import { useSyncExternalStore } from "react";

import { leer, reintentarTodo, suscribir } from "@/lib/guardado";

const vacio = { estado: "limpio" as const, ultimo: null, fallos: [], enVuelo: 0 };

function hora(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function IndicadorGuardado() {
  const s = useSyncExternalStore(suscribir, leer, () => vacio);

  if (s.estado === "limpio") return null;

  if (s.estado === "error") {
    const n = s.fallos.length;
    return (
      <div className="flex items-center gap-2">
        <span
          className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"
          title={s.fallos.map((f) => f.etiqueta).join("\n")}
        >
          ● Sin guardar{n ? ` (${n})` : ""}
        </span>
        {n > 0 && (
          <button
            type="button"
            onClick={() => void reintentarTodo()}
            className="rounded border border-red-600 px-2 py-0.5 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            Reintentar
          </button>
        )}
      </div>
    );
  }

  if (s.estado === "guardando") {
    return (
      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        Guardando…
      </span>
    );
  }

  return (
    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
      ✓ Guardado{s.ultimo ? ` ${hora(s.ultimo)}` : ""}
    </span>
  );
}
