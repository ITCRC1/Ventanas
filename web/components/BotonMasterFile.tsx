"use client";

// "Bajar todo": el Ventanas Master File, el libro completo con las 12 hojas.
//
// Vive en la barra de arriba y no dentro de un tab a proposito. Antes estaba en
// Job Cost, al final de la fila de la leyenda de estados, y no se encontraba:
// el archivo que resume TODO el proyecto no puede estar escondido en una
// pantalla.
//
// El libro se arma consultando la base entera, asi que tarda unos segundos. El
// boton lo dice mientras tanto — sin eso uno hace clic, no pasa nada visible, y
// vuelve a hacer clic.

import { useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useMe } from "@/lib/hooks";

export function BotonMasterFile() {
  const me = useMe();
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me.data?.permissions?.includes("report.view")) return null;

  async function bajar() {
    setBajando(true);
    setError(null);
    try {
      await api.abrir("/export/excel", true);
    } catch (e) {
      // El 401 ya lo atiende el cliente HTTP (manda a login). Acá solo se
      // muestra lo demás, para que un fallo no quede mudo.
      setError(e instanceof ApiError ? e.problem.title : "No se pudo generar");
    } finally {
      setBajando(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void bajar()}
      disabled={bajando}
      title={
        error ??
        "Ventanas Master File — el libro completo: Job Cost, Timeline, LEDGER, Bancos, Facturas y más, con todo por fórmula"
      }
      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
        error
          ? "border-red-300 bg-red-50 text-red-700"
          : "border-white/25 text-white hover:border-white/50 hover:bg-white/10"
      } ${bajando ? "opacity-60" : ""}`}
    >
      {bajando ? "Armando el libro…" : error ? `⚠ ${error}` : "⬇ Excel — todo"}
    </button>
  );
}
