// Estado de guardado, compartido por toda la app.
//
// ⚠️ Por qué existe. La app guarda campo por campo al salir del input
// (onBlur), sin botón ni confirmación. Mientras todo responde 200 eso se
// siente bien; cuando algo falla, no se siente nada. El 2026-11-07 la sesión
// se venció a media edición del desembolso #29.0 y el usuario siguió
// escribiendo veinte minutos contra una API que contestaba 401 a todo. Dos
// líneas se perdieron y lo primero que avisó fue un PDF que abrió una pestaña
// con el JSON del error.
//
// Acá se lleva la cuenta de qué pasó con el último guardado y de lo que quedó
// sin guardar, para que la barra de arriba lo muestre en el tab que sea.
// El cliente HTTP (lib/api.ts) reporta solo: ninguna vista tiene que acordarse.

export type EstadoGuardado = "limpio" | "guardando" | "guardado" | "error";

export interface Fallo {
  id: number;
  /** "PATCH /disbursements/31/lines/234" — para que se lea en la lista. */
  etiqueta: string;
  /** Reintento: la misma llamada, otra vez. */
  reintentar: () => Promise<unknown>;
  cuando: Date;
}

interface Estado {
  estado: EstadoGuardado;
  ultimo: Date | null;
  fallos: Fallo[];
  enVuelo: number;
}

let estado: Estado = { estado: "limpio", ultimo: null, fallos: [], enVuelo: 0 };
const oyentes = new Set<() => void>();
let contador = 0;

function emitir(nuevo: Partial<Estado>): void {
  estado = { ...estado, ...nuevo };
  oyentes.forEach((f) => f());
}

export function suscribir(f: () => void): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}

export function leer(): Estado {
  return estado;
}

export function empezoAGuardar(): void {
  emitir({ estado: "guardando", enVuelo: estado.enVuelo + 1 });
}

export function terminoBien(): void {
  const enVuelo = Math.max(0, estado.enVuelo - 1);
  emitir({
    enVuelo,
    ultimo: new Date(),
    // Si todavía quedan fallos sin resolver, el verde mentiría.
    estado: estado.fallos.length ? "error" : enVuelo ? "guardando" : "guardado",
  });
}

export function terminoMal(etiqueta: string, reintentar: (() => Promise<unknown>) | null): void {
  const enVuelo = Math.max(0, estado.enVuelo - 1);
  const fallos = reintentar
    ? [...estado.fallos, { id: ++contador, etiqueta, reintentar, cuando: new Date() }]
    : estado.fallos;
  emitir({ enVuelo, fallos, estado: "error" });
}

export function olvidarFallo(id: number): void {
  const fallos = estado.fallos.filter((f) => f.id !== id);
  emitir({ fallos, estado: fallos.length ? "error" : estado.enVuelo ? "guardando" : "guardado" });
}

/** Reintenta todo lo que quedó sin guardar. Lo que vuelve a fallar se queda. */
export async function reintentarTodo(): Promise<void> {
  const cola = estado.fallos;
  if (!cola.length) return;
  emitir({ estado: "guardando" });
  for (const f of cola) {
    try {
      await f.reintentar();
      olvidarFallo(f.id);
    } catch {
      // se queda en la lista; terminoMal ya lo habrá vuelto a anotar
    }
  }
  if (!leer().fallos.length) emitir({ estado: "guardado", ultimo: new Date() });
}
