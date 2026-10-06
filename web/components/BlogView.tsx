"use client";

/**
 * La bitácora del proyecto: entradas que sólo se agregan.
 *
 * Owner, 2026-10-06: *«quiero ir poniendo todas estas notas importantes para
 * que queden registradas… ningún blog se puede borrar una vez puesto; cuando
 * se agregue uno más, sólo se sigue el consecutivo»* · *«no se puede borrar ni
 * a mano»*.
 *
 * ⚠️ **No hay botón de borrar ni de editar, y no es un olvido.** La tabla
 * `finding_log` rechaza UPDATE y DELETE en la base (migración 0051) y el router
 * no expone esas rutas. Poner acá un botón que la API va a rechazar sería
 * ofrecer algo que no existe.
 *
 * Corregir es agregar: una entrada nueva que apunta a la vieja con «reemplaza
 * a #N». Las dos quedan, y así la bitácora conserva qué se supo y cuándo.
 *
 * El orden es del más nuevo al más viejo. El consecutivo va al frente de cada
 * entrada, así que no se pierde de vista; leer al revés obligaría a bajar hasta
 * el fondo para ver lo último, que es lo que casi siempre se busca.
 */

import { useState } from "react";
import { useBlog, useBlogPost, useMe } from "@/lib/hooks";

/** Fecha corta y legible. La hora no aporta en una bitácora mensual. */
function fecha(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("es-CR", { day: "2-digit", month: "short", year: "numeric" });
}

/** El consecutivo como se lee: 001, 014, 132. */
const consecutivo = (n: number) => String(n).padStart(3, "0");

/**
 * El texto de una entrada, respetando lo que viene alineado.
 *
 * Owner, 2026-10-06, viendo la #001: *«debes mejorar las tablas, se ven mal
 * alineadas»*.
 *
 * ⚠️ **El arreglo tiene que estar acá y no en el texto.** Una entrada no se
 * puede editar —de eso se trata la bitácora—, así que la que ya está escrita
 * no se va a reformatear nunca. Lo que cambia es cómo se lee.
 *
 * El texto se guarda plano, con las columnas armadas a espacios. En
 * tipografía proporcional una «i» mide menos que una «M» y la alineación se
 * deshace. Así que las corridas de líneas alineadas salen en monoespaciada, y
 * la prosa se queda proporcional, que es como se lee mejor.
 */
type Trozo =
  | { tipo: "titulo"; texto: string }
  | { tipo: "parrafo"; texto: string }
  | { tipo: "tabla"; lineas: string[] };

/** Una línea con dos o más espacios seguidos viene alineada a mano. */
const pareceFila = (l: string) => /\S {2,}\S/.test(l);

/** Un rótulo del cuerpo: corto y en mayúsculas («EL CONTRATO»). */
const pareceTitulo = (l: string) => {
  const t = l.trim();
  return t.length > 0 && t.length <= 70 && t === t.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(t);
};

function trocear(texto: string): Trozo[] {
  const out: Trozo[] = [];
  let parrafo: string[] = [];
  let corrida: string[] = [];

  const cerrarParrafo = () => {
    if (parrafo.length) out.push({ tipo: "parrafo", texto: parrafo.join("\n") });
    parrafo = [];
  };
  // ⚠️ Una sola línea con doble espacio NO es una tabla: puede ser prosa con
  // dos espacios después de un punto. Hacen falta dos seguidas para que valga
  // la pena romper la tipografía.
  const cerrarCorrida = () => {
    if (corrida.length >= 2) {
      cerrarParrafo();
      out.push({ tipo: "tabla", lineas: corrida });
    } else {
      parrafo.push(...corrida);
    }
    corrida = [];
  };

  for (const l of texto.split("\n")) {
    if (pareceFila(l)) {
      corrida.push(l);
      continue;
    }
    cerrarCorrida();
    if (!l.trim()) {
      cerrarParrafo();
      continue;
    }
    if (pareceTitulo(l)) {
      cerrarParrafo();
      out.push({ tipo: "titulo", texto: l.trim() });
      continue;
    }
    parrafo.push(l);
  }
  cerrarCorrida();
  cerrarParrafo();
  return out;
}

function Texto({ texto }: { texto: string }) {
  return (
    <>
      {trocear(texto).map((t, i) =>
        t.tipo === "titulo" ? (
          <h3 key={i} className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t.texto}
          </h3>
        ) : t.tipo === "tabla" ? (
          // `overflow-x-auto`: una tabla ancha se desplaza, no se parte. Partida
          // pierde justo la alineación que este bloque existe para conservar.
          <pre
            key={i}
            className="mt-2 overflow-x-auto rounded bg-slate-50 px-3 py-2 font-mono text-xs leading-5 text-slate-800"
          >
            {t.lineas.join("\n")}
          </pre>
        ) : (
          <p key={i} className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
            {t.texto}
          </p>
        ),
      )}
    </>
  );
}

export function BlogView() {
  const entradas = useBlog();
  const me = useMe();
  const crear = useBlogPost();
  const puedeEscribir = (me.data?.permissions ?? []).includes("blog.post");

  const [abierto, setAbierto] = useState(false);
  const [subject, setSubject] = useState("");
  const [finding, setFinding] = useState("");
  const [action, setAction] = useState("");
  const [source, setSource] = useState("");
  const [supersedes, setSupersedes] = useState("");

  const limpiar = () => {
    setSubject("");
    setFinding("");
    setAction("");
    setSource("");
    setSupersedes("");
    setAbierto(false);
  };

  const guardar = () => {
    crear.mutate(
      {
        subject,
        finding,
        action: action || null,
        source: source || null,
        supersedes: supersedes ? Number(supersedes) : null,
      },
      { onSuccess: limpiar },
    );
  };

  const filas = [...(entradas.data?.entries ?? [])].sort((a, b) => b.log_no - a.log_no);
  const listo = subject.trim().length > 0 && finding.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Las entradas <strong>no se borran ni se editan</strong> — ni desde acá ni a mano: la base las
        rechaza. Una corrección entra como entrada nueva que cita la anterior.
      </div>

      {puedeEscribir && !abierto && (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-800"
        >
          + Nueva entrada
        </button>
      )}

      {puedeEscribir && abierto && (
        <div className="space-y-3 rounded border border-slate-300 bg-white p-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Asunto</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Cierre 4.2.1 · asiento #2 del ledger"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Hallazgo</label>
            <textarea
              value={finding}
              onChange={(e) => setFinding(e.target.value)}
              rows={5}
              placeholder="Qué se encontró, con las cifras y contra qué se comparó."
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Qué hay que hacer <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <textarea
              value={action}
              onChange={(e) => setAction(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Fuente <span className="font-normal text-slate-400">(contrato, asiento, correo)</span>
            </label>
            <input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Contrato 18-oct-2024, cláusula 4.2.1"
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Reemplaza a la entrada #{" "}
              <span className="font-normal text-slate-400">(sólo si corrige una anterior)</span>
            </label>
            <input
              value={supersedes}
              onChange={(e) => setSupersedes(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              className="mt-1 w-24 rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          {crear.isError && (
            <p className="text-sm text-red-600">
              No se guardó: {(crear.error as Error).message}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!listo || crear.isPending}
              onClick={guardar}
              className="rounded bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {crear.isPending ? "Guardando…" : "Registrar"}
            </button>
            <button
              type="button"
              onClick={limpiar}
              className="rounded border border-slate-300 px-4 py-2 text-sm"
            >
              Cancelar
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Una vez registrada no se puede corregir ni borrar. Revisá antes de guardar.
          </p>
        </div>
      )}

      {entradas.isLoading && <p className="text-sm text-slate-500">Cargando…</p>}
      {!entradas.isLoading && filas.length === 0 && (
        <p className="text-sm text-slate-500">Todavía no hay entradas.</p>
      )}

      {filas.map((e) => (
        <article
          key={e.log_no}
          className={`rounded border bg-white p-4 ${
            e.fue_reemplazada ? "border-slate-200 opacity-70" : "border-slate-300"
          }`}
        >
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-lg font-semibold text-brand-700">
              #{consecutivo(e.log_no)}
            </span>
            <h2 className="text-base font-semibold text-slate-900">{e.subject}</h2>
            <span className="text-xs text-slate-500">
              {fecha(e.logged_at)}
              {e.autor ? ` · ${e.autor}` : ""}
            </span>
            {e.reemplaza_a !== null && (
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                reemplaza a #{consecutivo(e.reemplaza_a)}
              </span>
            )}
            {e.fue_reemplazada && (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                reemplazada por una entrada posterior
              </span>
            )}
          </header>

          <div className="mt-3">
            <Texto texto={e.finding} />
          </div>

          {e.action && (
            <div className="mt-4 border-l-2 border-brand-200 pl-3">
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                Qué hay que hacer
              </span>
              <Texto texto={e.action} />
            </div>
          )}

          {e.source && <p className="mt-3 text-xs text-slate-500">Fuente: {e.source}</p>}
        </article>
      ))}
    </div>
  );
}
