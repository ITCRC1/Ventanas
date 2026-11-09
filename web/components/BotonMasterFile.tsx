"use client";

// "Bajar todo": el Ventanas Master File, el libro completo con las 12 hojas.
//
// Va en la barra de arriba Y en Job Cost. Primero lo puse solo en la barra,
// pensando que tenerlo en dos lados era ruido; a la media hora el owner lo
// estaba buscando en Job Cost, que es donde siempre estuvo. La costumbre de
// quien lo usa gana: el boton se pone donde la mano lo va a buscar.
//
// Por eso tambien se llama "Master File" en los dos lados y no "Excel - todo":
// el nombre con el que se lo conoce es el que se reconoce.
//
// El libro se arma consultando la base entera, asi que tarda unos segundos. El
// boton lo dice mientras tanto — sin eso uno hace clic, no pasa nada visible, y
// vuelve a hacer clic.

import { useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useMe } from "@/lib/hooks";

export function BotonMasterFile({ tono = "barra" }: { tono?: "barra" | "pagina" }) {
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
      setError(e instanceof ApiError ? e.problem.title : "Could not generate it");
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
        "Ventanas Master File — the whole book: Job Cost, Timeline, LEDGER, Banks, Invoices and more, every figure by formula"
      }
      className={`rounded-md border font-medium transition ${
        tono === "barra" ? "px-2.5 py-1 text-xs" : "px-3 py-1 text-sm font-semibold"
      } ${
        error
          ? "border-red-300 bg-red-50 text-red-700"
          : tono === "barra"
            ? "border-white/25 text-white hover:border-white/50 hover:bg-white/10"
            : "border-emerald-600 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
      } ${bajando ? "opacity-60" : ""}`}
    >
      {bajando
        ? "Armando el libro…"
        : error
          ? `⚠ ${error}`
          : tono === "barra"
            ? "⬇ Master File"
            : "⬇ Ventanas Master File"}
    </button>
  );
}
