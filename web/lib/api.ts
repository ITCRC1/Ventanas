// Cliente HTTP. Todas las llamadas van a /api/* (Next reenvía al FastAPI) con la
// cookie de sesión. Los errores llegan en formato problem+json (RFC 7807).

import { empezoAGuardar, terminoBien, terminoMal } from "./guardado";

export interface ProblemError {
  status: number;
  title: string;
  detail?: string;
}

export class ApiError extends Error {
  problem: ProblemError;
  constructor(problem: ProblemError) {
    super(problem.detail ?? problem.title);
    this.problem = problem;
  }
}

// ⚠️ La sesión dura 8 horas y se moría sin avisar. Cuando se vencía, la
// pantalla seguía mostrando los datos que ya tenía en caché y cada guardado
// contestaba 401 en silencio: se podía editar media hora contra una sesión
// muerta y perderlo todo. Pasó el 2026-11-07 con el desembolso #29.0.
//
// Acá pasan TODAS las llamadas, así que el 401 se atiende una sola vez y vale
// para la app entera: se manda a login con la ruta actual para volver.
let yendoALogin = false;
function sesionVencida(): void {
  if (typeof window === "undefined" || yendoALogin) return;
  if (window.location.pathname.startsWith("/login")) return;
  yendoALogin = true;
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}&vencida=1`);
}

async function problema(res: Response): Promise<ProblemError> {
  let p: ProblemError = { status: res.status, title: res.statusText };
  try {
    p = { ...p, ...(await res.json()) };
  } catch {
    // respuesta sin cuerpo JSON
  }
  return p;
}

async function crudo<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    if (res.status === 401) sesionVencida();
    throw new ApiError(await problema(res));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// PATCH, PUT y DELETE se pueden repetir sin consecuencias: si fallan, quedan en
// la cola y el botón "Reintentar" los vuelve a mandar. POST no — repetir un
// POST crea dos. Ese se reporta como fallo pero sin reintento automático.
const REPETIBLE = new Set(["PATCH", "PUT", "DELETE"]);

async function escribir<T>(metodo: string, path: string, init: RequestInit): Promise<T> {
  empezoAGuardar();
  try {
    const r = await crudo<T>(path, init);
    terminoBien();
    return r;
  } catch (e) {
    const repetir = REPETIBLE.has(metodo) ? () => crudo<T>(path, init) : null;
    terminoMal(`${metodo} ${path}`, repetir);
    throw e;
  }
}

/** Abre un PDF, Excel o adjunto de /api/* respetando la sesión.
 *
 * Un `<a href="/api/...">` suelto le entrega al navegador lo que conteste la
 * API: con la sesión vencida, eso es una pestaña con el JSON del error crudo
 * —que fue justo lo que se vio—. Acá se pide con fetch, el 401 cae en el mismo
 * camino que el resto de la app y el usuario termina en login.
 *
 * La pestaña se abre ANTES del fetch, dentro del gesto del clic: abrirla
 * después la bloquea el navegador por venir de un callback asíncrono.
 */
export async function abrirArchivo(path: string, descargar = false): Promise<void> {
  const w = descargar ? null : window.open("", "_blank");
  try {
    const res = await fetch(`/api${path}`, { credentials: "include" });
    if (!res.ok) {
      w?.close();
      if (res.status === 401) sesionVencida();
      throw new ApiError(await problema(res));
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (descargar) {
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop() ?? "archivo";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else if (w) {
      w.location.href = url;
    } else {
      window.open(url, "_blank");
    }
    // Un minuto alcanza para que el visor lo cargue; después se libera.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    w?.close();
    throw e;
  }
}

export const api = {
  get: <T>(path: string) => crudo<T>(path),
  post: <T>(path: string, body: unknown) =>
    escribir<T>("POST", path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    escribir<T>("PATCH", path, { method: "PATCH", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    escribir<T>("PUT", path, { method: "PUT", body: JSON.stringify(body) }),
  del: <T>(path: string) => escribir<T>("DELETE", path, { method: "DELETE" }),
  abrir: abrirArchivo,
};
