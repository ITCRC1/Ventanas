"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ApiError, api } from "@/lib/api";

// --- tipos -------------------------------------------------------------------

interface Perm {
  code: string;
  description: string;
  group: "view" | "action" | "admin";
}
interface Role {
  id: number;
  code: string;
  name: string;
  permissions: string[];
  user_count: number;
}
interface AdminUser {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  role_id: number;
  role: string;
  is_active: boolean;
  has_password: boolean;
  last_login: string | null;
  invite_pending: boolean;
  invite_token?: string | null;
  invite_days?: number | null;
}

// --- componente --------------------------------------------------------------

export function AdminPanel() {
  const [tab, setTab] = useState<"profiles" | "users">("profiles");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["profiles", "users"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t
                ? "bg-[#2d3a5c] text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t === "profiles" ? "Profiles" : "Users"}
          </button>
        ))}
      </div>
      {tab === "profiles" ? <Profiles /> : <Users />}
    </div>
  );
}

// --- Perfiles ----------------------------------------------------------------

function Profiles() {
  const qc = useQueryClient();
  const roles = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => api.get<Role[]>("/admin/roles"),
  });
  const perms = useQuery({
    queryKey: ["admin-perms"],
    queryFn: () => api.get<Perm[]>("/admin/permissions"),
  });
  const [sel, setSel] = useState<number | null>(null);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");

  const selected = roles.data?.find((r) => r.id === sel) ?? roles.data?.[0] ?? null;
  const selId = selected?.id ?? null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-roles"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };

  const savePerms = useMutation({
    mutationFn: (v: { id: number; permissions: string[] }) =>
      api.put(`/admin/roles/${v.id}/permissions`, { permissions: v.permissions }),
    onSuccess: invalidate,
  });
  const createRole = useMutation({
    mutationFn: (v: { code: string; name: string }) => api.post("/admin/roles", v),
    onSuccess: () => {
      setNewCode("");
      setNewName("");
      invalidate();
    },
  });
  const delRole = useMutation({
    mutationFn: (id: number) => api.del(`/admin/roles/${id}`),
    onSuccess: invalidate,
  });

  function togglePerm(code: string) {
    if (!selected) return;
    const has = selected.permissions.includes(code);
    const next = has
      ? selected.permissions.filter((p) => p !== code)
      : [...selected.permissions, code];
    savePerms.mutate({ id: selected.id, permissions: next });
  }

  const groups = useMemo(() => {
    const view = (perms.data ?? []).filter((p) => p.group === "view");
    const admin = (perms.data ?? []).filter((p) => p.group === "admin");
    const action = (perms.data ?? []).filter((p) => p.group === "action");
    return { view: [...view, ...admin], action };
  }, [perms.data]);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
      {/* lista de perfiles */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
          Profiles
        </div>
        <div className="divide-y divide-slate-100">
          {(roles.data ?? []).map((r) => (
            <button
              key={r.id}
              onClick={() => setSel(r.id)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                selId === r.id ? "bg-slate-50 font-semibold" : "hover:bg-slate-50"
              }`}
            >
              <span>
                {r.name}
                <span className="ml-1 text-xs text-slate-400">({r.code})</span>
              </span>
              <span className="text-xs text-slate-400">{r.user_count}👤</span>
            </button>
          ))}
        </div>
        <div className="space-y-2 border-t border-slate-100 p-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Profile name (e.g. Owner)"
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
            placeholder="code (e.g. owner)"
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
          />
          <button
            onClick={() =>
              newCode && newName && createRole.mutate({ code: newCode, name: newName })
            }
            disabled={createRole.isPending || !newCode || !newName}
            className="w-full rounded bg-[#2d3a5c] px-2 py-1 text-sm font-medium text-white disabled:opacity-50"
          >
            + New profile
          </button>
          {createRole.error instanceof ApiError && (
            <p className="text-xs text-red-600">{createRole.error.problem.title}</p>
          )}
        </div>
      </div>

      {/* permisos del perfil seleccionado */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        {selected ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">{selected.name}</h3>
                <p className="text-xs text-slate-400">
                  {selected.user_count} user(s) · code «{selected.code}»
                </p>
              </div>
              {selected.user_count === 0 && (
                <button
                  onClick={() =>
                    confirm(`Delete profile "${selected.name}"?`) && delRole.mutate(selected.id)
                  }
                  className="text-xs text-slate-400 hover:text-rose-600"
                >
                  delete
                </button>
              )}
            </div>
            {delRole.error instanceof ApiError && (
              <p className="mb-2 text-xs text-red-600">{delRole.error.problem.detail}</p>
            )}

            <p className="mb-1 text-xs font-semibold uppercase text-slate-500">
              Sections this profile can see
            </p>
            <div className="mb-4 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {groups.view.map((p) => (
                <PermRow
                  key={p.code}
                  label={p.description}
                  checked={selected.permissions.includes(p.code)}
                  onToggle={() => togglePerm(p.code)}
                />
              ))}
            </div>
            <p className="mb-1 text-xs font-semibold uppercase text-slate-500">
              Actions (edit / approve)
            </p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {groups.action.map((p) => (
                <PermRow
                  key={p.code}
                  label={p.description}
                  checked={selected.permissions.includes(p.code)}
                  onToggle={() => togglePerm(p.code)}
                />
              ))}
            </div>
            {savePerms.isPending && <p className="mt-2 text-xs text-slate-400">Saving…</p>}
          </>
        ) : (
          <p className="text-sm text-slate-400">Select a profile.</p>
        )}
      </div>
    </div>
  );
}

function PermRow({
  label,
  checked,
  onToggle,
}: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className={checked ? "text-slate-800" : "text-slate-500"}>{label}</span>
    </label>
  );
}

// --- Usuarios ----------------------------------------------------------------

function Users() {
  const qc = useQueryClient();
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => api.get<AdminUser[]>("/admin/users"),
  });
  const roles = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => api.get<Role[]>("/admin/roles"),
  });
  const [nf, setNf] = useState({ full_name: "", email: "", role_id: 0 });
  // El link recien emitido. Se muestra UNA vez: si se pierde, se emite otro.
  const [link, setLink] = useState<{ nombre: string; url: string; dias: number } | null>(null);
  const urlDe = (t: string) =>
    `${typeof window === "undefined" ? "" : window.location.origin}/invite?t=${t}`;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const createUser = useMutation({
    mutationFn: (v: typeof nf) => api.post<AdminUser>("/admin/users", v),
    onSuccess: (u) => {
      if (u.invite_token)
        setLink({ nombre: u.full_name, url: urlDe(u.invite_token), dias: u.invite_days ?? 7 });
      setNf({ full_name: "", email: "", role_id: 0 });
      invalidate();
    },
  });
  const patchUser = useMutation({
    mutationFn: (v: { id: number; body: Record<string, unknown> }) =>
      api.patch(`/admin/users/${v.id}`, v.body),
    onSuccess: invalidate,
  });
  // ⚠️ Reemplaza al viejo "reset password", donde el administrador tecleaba
  // una clave y se la mandaba por fuera. Ahora emite un link y la persona pone
  // la suya: el admin no la ve ni la elige.
  const reinvitar = useMutation({
    mutationFn: (v: { id: number; nombre: string }) =>
      api.post<{ invite_token: string; invite_days: number }>(`/admin/users/${v.id}/invite`, {}),
    onSuccess: (r, v) =>
      setLink({ nombre: v.nombre, url: urlDe(r.invite_token), dias: r.invite_days }),
    onSettled: invalidate,
  });

  const roleOpts = roles.data ?? [];

  return (
    <div className="space-y-4">
      {/* ⚠️ El link se ve UNA sola vez. No se guarda en ningun lado en claro:
          en la base vive hasheado, asi que no hay de donde recuperarlo. */}
      {link ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3">
          <p className="text-sm font-semibold text-emerald-900">Invite link for {link.nombre}</p>
          <p className="mb-2 text-xs text-emerald-800">
            Send this link to the person: they open it and create their own password. It works once
            and expires in {link.dias} days. You won&apos;t see it again.
          </p>
          <div className="flex gap-2">
            <input
              readOnly
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 rounded border border-emerald-300 bg-white px-2 py-1 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(link.url)}
              className="rounded bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-800"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={() => setLink(null)}
              className="rounded border border-emerald-300 px-2 py-1 text-xs text-emerald-800"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      {/* alta */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold">Add user</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
          <input
            value={nf.full_name}
            onChange={(e) => setNf({ ...nf, full_name: e.target.value })}
            placeholder="Full name"
            className="rounded border border-slate-300 px-2 py-1 text-sm sm:col-span-1"
          />
          <input
            value={nf.email}
            onChange={(e) => setNf({ ...nf, email: e.target.value })}
            placeholder="email@company.com"
            className="rounded border border-slate-300 px-2 py-1 text-sm sm:col-span-2"
          />
          <select
            value={nf.role_id}
            onChange={(e) => setNf({ ...nf, role_id: Number(e.target.value) })}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value={0}>Profile…</option>
            {roleOpts.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <input
            hidden
            readOnly
            value=""
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => createUser.mutate(nf)}
            disabled={createUser.isPending || !nf.full_name || !nf.email || !nf.role_id}
            className="rounded bg-[#2d3a5c] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Create user
          </button>
          {createUser.error instanceof ApiError && (
            <span className="text-xs text-red-600">{createUser.error.problem.title}</span>
          )}
          <span className="text-xs text-slate-400">
            No password here: creating the user produces a one-time invite link. Send it to the
            person &mdash; they open it and choose their own password.
          </span>
        </div>
      </div>

      {/* lista */}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Profile</th>
              <th className="px-3 py-2 text-center">Active</th>
              <th className="px-3 py-2 text-center">Access</th>
              <th className="px-3 py-2 text-left">Last sign-in</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(users.data ?? []).map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-3 py-1.5">{u.full_name}</td>
                <td className="px-3 py-1.5 text-slate-500">{u.email}</td>
                <td className="px-3 py-1.5">
                  <select
                    value={u.role_id}
                    onChange={(e) =>
                      patchUser.mutate({ id: u.id, body: { role_id: Number(e.target.value) } })
                    }
                    className="rounded border border-slate-300 px-2 py-1 text-sm"
                  >
                    {roleOpts.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={u.is_active}
                    onChange={(e) =>
                      patchUser.mutate({ id: u.id, body: { is_active: e.target.checked } })
                    }
                  />
                </td>
                <td className="px-3 py-1.5 text-center text-xs">
                  {u.invite_pending ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                      invitation sent
                    </span>
                  ) : u.has_password ? (
                    <span className="text-emerald-600">active</span>
                  ) : (
                    <span className="text-red-600">no access</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-xs text-slate-500">
                  {u.last_login ? new Date(u.last_login).toLocaleString() : "never"}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <button
                    onClick={() => reinvitar.mutate({ id: u.id, nombre: u.full_name })}
                    disabled={reinvitar.isPending}
                    className="text-xs text-indigo-600 hover:underline disabled:opacity-40"
                  >
                    invite link
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
