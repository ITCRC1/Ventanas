"use client";

import { ApiError } from "@/lib/api";
import { useAuthConfig, useDevLogin, usePasswordLogin, useSharedLogin } from "@/lib/hooks";
import { useRouter } from "next/navigation";
import { useState } from "react";

const USERS = [
  { username: "bismark", label: "Financial Controller" },
  { username: "blake", label: "Blake — Project Manager" },
  { username: "corporativo", label: "Corporate" },
  { username: "administracion", label: "Administration" },
  { username: "ronald", label: "Ronald (read-only)" },
];

export default function LoginPage() {
  const router = useRouter();
  const config = useAuthConfig();
  const devLogin = useDevLogin();
  const sharedLogin = useSharedLogin();
  const passwordLogin = usePasswordLogin();

  const [username, setUsername] = useState("bismark");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shared, setShared] = useState("");
  const [mode, setMode] = useState<"email" | "shared">("email");

  const err = devLogin.error ?? sharedLogin.error ?? passwordLogin.error;
  const isDev = config.data?.dev_login ?? false;

  function dest() {
    const next =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("next")
        : null;
    return next && next.startsWith("/") && !next.startsWith("//") ? next : "/job-cost";
  }
  async function go(p: Promise<unknown>) {
    try {
      await p;
      router.push(dest());
    } catch {
      /* mostrado abajo */
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard Ventanas</h1>
        <p className="text-sm text-slate-500">Project financial control</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        {isDev ? (
          <>
            <label className="mb-2 block text-sm font-medium" htmlFor="user">
              Sign in as (development)
            </label>
            <select
              id="user"
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            >
              {USERS.map((u) => (
                <option key={u.username} value={u.username}>
                  {u.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => go(devLogin.mutateAsync(username))}
              disabled={devLogin.isPending}
              className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {devLogin.isPending ? "Signing in…" : "Sign in"}
            </button>
          </>
        ) : mode === "email" ? (
          <>
            <label className="mb-1 block text-sm font-medium" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="mb-3 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
            <label className="mb-1 block text-sm font-medium" htmlFor="pw">
              Password
            </label>
            <input
              id="pw"
              type="password"
              autoComplete="current-password"
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go(passwordLogin.mutateAsync({ email, password }))}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => go(passwordLogin.mutateAsync({ email, password }))}
              disabled={passwordLogin.isPending}
              className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {passwordLogin.isPending ? "Signing in…" : "Sign in"}
            </button>
            {config.data?.shared_gate && (
              <button
                type="button"
                onClick={() => setMode("shared")}
                className="mt-3 w-full text-center text-xs text-slate-400 hover:text-slate-600"
              >
                Use the shared access password
              </button>
            )}
          </>
        ) : (
          <>
            <label className="mb-2 block text-sm font-medium" htmlFor="shared">
              Shared access password
            </label>
            <input
              id="shared"
              type="password"
              className="mb-4 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              value={shared}
              onChange={(e) => setShared(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go(sharedLogin.mutateAsync(shared))}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => go(sharedLogin.mutateAsync(shared))}
              disabled={sharedLogin.isPending}
              className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {sharedLogin.isPending ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              onClick={() => setMode("email")}
              className="mt-3 w-full text-center text-xs text-slate-400 hover:text-slate-600"
            >
              Back to email sign-in
            </button>
          </>
        )}
        {err instanceof ApiError && (
          <p className="mt-3 text-sm text-red-600">{err.problem.detail ?? err.problem.title}</p>
        )}
      </div>
    </main>
  );
}
