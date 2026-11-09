"use client";

/**
 * Mi cuenta: cambiar mi propia contraseña.
 *
 * ⚠️ Hasta el 2026-11-08 esto NO EXISTÍA. La única manera de cambiar una clave
 * era pedirle al administrador que tecleara otra, con lo cual el administrador
 * terminaba conociendo la clave de todos.
 *
 * Pide la actual aunque haya sesión abierta: una sesión olvidada en una máquina
 * ajena no debería alcanzar para quedarse con la cuenta.
 */

import { ApiError, api } from "@/lib/api";
import { useMe } from "@/lib/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CuentaPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();

  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const obligada = me.data?.must_change ?? false;

  // La misma regla que valida el servidor. Acá sólo para avisar antes de
  // mandar: la que manda es la del servidor.
  const corta = nueva.length < 10;
  const sinMezcla = !/[a-zA-Z]/.test(nueva) || !/\d/.test(nueva);
  const distintas = repetida.length > 0 && nueva !== repetida;
  const puede = actual.length > 0 && !corta && !sinMezcla && nueva === repetida && !guardando;

  async function guardar() {
    if (!puede) return;
    setGuardando(true);
    setError(null);
    try {
      await api.post("/auth/change-password", { current: actual, new: nueva });
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.push("/job-cost");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? (e.problem.detail ?? e.problem.title)
          : "Could not change the password.",
      );
      setGuardando(false);
    }
  }

  return (
    <main className="mx-auto max-w-md space-y-5 p-6">
      {/* Esta pantalla no lleva el shell: sin esto, quien entra a mirar y no
          cambia nada se queda sin manera de volver. */}
      {obligada ? null : (
        <button
          type="button"
          onClick={() => router.push("/job-cost")}
          className="text-sm text-slate-500 hover:underline"
        >
          &larr; Back
        </button>
      )}

      <div>
        <h1 className="text-xl font-semibold">My account</h1>
        {me.data ? (
          <p className="text-sm text-slate-500">
            {me.data.full_name} · {me.data.email}
          </p>
        ) : null}
      </div>

      {obligada ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This is your first sign-in with a temporary password. Set your own to continue.
        </div>
      ) : null}

      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-slate-400">
            Current password {obligada ? "(the temporary one)" : ""}
          </span>
          <input
            type="password"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            autoFocus
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-slate-400">New</span>
          <input
            type="password"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-slate-400">Repeat it</span>
          <input
            type="password"
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void guardar()}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
          />
        </label>

        <p className="text-xs text-slate-500">
          At least 10 characters, with letters and numbers.
          {nueva.length > 0 && corta ? (
            <span className="text-amber-700"> {10 - nueva.length} to go.</span>
          ) : null}
          {nueva.length > 0 && !corta && sinMezcla ? (
            <span className="text-amber-700"> Mix letters and numbers.</span>
          ) : null}
          {distintas ? <span className="text-red-600"> They do not match.</span> : null}
        </p>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="button"
          onClick={() => void guardar()}
          disabled={!puede}
          className="w-full rounded bg-[#2d3a5c] px-4 py-2 font-medium text-white hover:bg-[#3d4a6c] disabled:opacity-40"
        >
          {guardando ? "Saving…" : "Change password"}
        </button>
      </div>
    </main>
  );
}
