"use client";

/**
 * La persona abre su invitación y elige su propia contraseña.
 *
 * ⚠️ Antes esta pantalla no existía: el administrador tecleaba una clave al
 * crear el usuario y se la pasaba por WhatsApp. Esa clave viajaba en claro por
 * un canal que nadie controla, quedaba en el historial del chat, y el admin la
 * conocía para siempre.
 *
 * El link sirve UNA vez y vence. Si está usado o vencido, acá no se disimula:
 * se dice, y se manda a pedir otro.
 */

import { ApiError, api } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Invitado {
  full_name: string;
  email: string | null;
}

export default function InvitePage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [quien, setQuien] = useState<Invitado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [guardando, setGuardando] = useState(false);

  // En un efecto y no al renderizar: leer window durante el render le da al
  // servidor un HTML distinto al del navegador y React avisa por hidratación.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t");
    if (!t) {
      setError("El link está incompleto. Pedí uno nuevo al administrador.");
      return;
    }
    setToken(t);
    api
      .post<Invitado>("/auth/invite", { token: t })
      .then(setQuien)
      .catch((e) =>
        setError(
          e instanceof ApiError
            ? (e.problem.detail ?? e.problem.title)
            : "No se pudo abrir la invitación.",
        ),
      );
  }, []);

  // La misma regla que valida el servidor. Se repite acá sólo para avisar
  // antes de mandar: la que manda es la del servidor.
  const corta = pw.length < 10;
  const sinMezcla = !/[a-zA-Z]/.test(pw) || !/\d/.test(pw);
  const distintas = pw2.length > 0 && pw !== pw2;
  const puede = !corta && !sinMezcla && pw === pw2 && !guardando;

  async function guardar() {
    if (!token || !puede) return;
    setGuardando(true);
    setError(null);
    try {
      await api.post("/auth/invite", { token, password: pw });
      router.push("/job-cost");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : "No se pudo guardar la contraseña.",
      );
      setGuardando(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard Ventanas</h1>
        <p className="text-sm text-slate-500">Project financial control</p>
      </div>

      {quien ? (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
          <div>
            <p className="text-lg font-semibold">Hola, {quien.full_name}</p>
            <p className="text-sm text-slate-500">
              Elegí tu contraseña. Nadie más la va a saber — ni el administrador.
            </p>
            {quien.email ? (
              <p className="mt-1 text-xs text-slate-400">Vas a entrar con {quien.email}</p>
            ) : null}
          </div>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-400">Contraseña</span>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoFocus
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-slate-400">Repetila</span>
            <input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void guardar()}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            />
          </label>

          <p className="text-xs text-slate-500">
            Al menos 10 caracteres, con letras y números.
            {pw.length > 0 && corta ? (
              <span className="text-amber-700"> Te faltan {10 - pw.length}.</span>
            ) : null}
            {pw.length > 0 && !corta && sinMezcla ? (
              <span className="text-amber-700"> Falta mezclar letras y números.</span>
            ) : null}
            {distintas ? <span className="text-red-600"> Las dos no coinciden.</span> : null}
          </p>

          <button
            type="button"
            onClick={() => void guardar()}
            disabled={!puede}
            className="w-full rounded bg-[#2d3a5c] px-4 py-2 font-medium text-white hover:bg-[#3d4a6c] disabled:opacity-40"
          >
            {guardando ? "Guardando…" : "Entrar"}
          </button>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-5">
          <p className="font-semibold text-red-800">No se pudo abrir la invitación</p>
          <p className="mt-1 text-sm text-red-700">{error}</p>
          <p className="mt-3 text-xs text-red-600">
            Los links sirven una sola vez y vencen. Pedile otro al administrador.
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Abriendo la invitación…</p>
      )}

      {quien && error ? <p className="text-sm text-red-600">{error}</p> : null}
    </main>
  );
}
