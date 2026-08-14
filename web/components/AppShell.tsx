"use client";

import { useLogout, useMe } from "@/lib/hooks";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";

type NavLink = { href: string; label: string; hint?: string; perm?: string };
type NavItem = NavLink | { label: string; items: NavLink[]; perm?: string };

// Barra agrupada por flujo de trabajo: lo del proyecto, lo que se le pide a
// corporativo, las facturas y lo bancario. El Cronograma sigue fuera del menú
// (redundante con la edición semanal de Job Cost); la ruta /schedule sigue viva.
const NAV: NavItem[] = [
  {
    href: "/job-cost",
    label: "Job Cost",
    hint: "Budget, spend and forecast by project",
    perm: "view.jobcost",
  },
  {
    label: "Timeline",
    perm: "view.timeline",
    items: [
      { href: "/timeline", label: "Timeline", hint: "Roll-up by category" },
      { href: "/timeline-detail", label: "Timeline Detail", hint: "Week by week, per task" },
    ],
  },
  { href: "/dashboard", label: "Dashboard", hint: "Executive summary", perm: "report.view" },
  {
    href: "/planning",
    label: "Planning",
    hint: "Prepare and approve what's coming",
    perm: "view.planning",
  },
  {
    label: "Payments",
    perm: "view.payments",
    items: [
      { href: "/payments", label: "Short Term Payments", hint: "The batch sent to corporate" },
      { href: "/disbursements", label: "Disbursements", hint: "Build and submit the batch" },
      { href: "/credit", label: "Credits", hint: "Credit balance and adjustments" },
    ],
  },
  {
    label: "Invoices",
    perm: "view.invoices",
    items: [
      { href: "/invoice-receipts", label: "Invoice Receipts", hint: "Inbox — invoices by email" },
      {
        href: "/invoices-applied",
        label: "Invoices Applied",
        hint: "Invoiced vs spent, by project",
      },
      { href: "/match-review", label: "Match Review", hint: "Confirm the suggested matches" },
      { href: "/ledger-invoices", label: "Ledger + Invoices", hint: "Which lines have no invoice" },
      { href: "/invoices", label: "Invoices (manual)", hint: "Invoices captured by hand" },
    ],
  },
  { href: "/ledger", label: "Ledger", hint: "Every payment, as in the Excel", perm: "view.ledger" },
  {
    label: "Banking",
    perm: "bank.view",
    items: [
      { href: "/bank", label: "Banks", hint: "Statements and reconciliation" },
      {
        href: "/bank-reconciliation",
        label: "Bank Reconciliation",
        hint: "LAFISE statement vs Ledger, Short Payments & invoices",
      },
      { href: "/us-wires", label: "US Wire Transfers", hint: "Owner contributions" },
    ],
  },
  { href: "/admin", label: "Admin", hint: "Profiles & users", perm: "admin.users" },
];

// Ruta → permiso que la protege (más específica primero). Espeja el NAV para el
// guard: si el usuario entra por URL a algo que su perfil no ve, se le redirige.
const ROUTE_PERM = (
  [
    ["/job-cost", "view.jobcost"],
    ["/schedule", "view.jobcost"],
    ["/timeline-detail", "view.timeline"],
    ["/timeline", "view.timeline"],
    ["/dashboard", "report.view"],
    ["/planning", "view.planning"],
    ["/payments", "view.payments"],
    ["/disbursements", "view.payments"],
    ["/credit", "view.payments"],
    ["/invoice-receipts", "view.invoices"],
    ["/invoices-applied", "view.invoices"],
    ["/match-review", "view.invoices"],
    ["/ledger-invoices", "view.invoices"],
    ["/invoices", "view.invoices"],
    ["/ledger", "view.ledger"],
    ["/bank-reconciliation", "bank.view"],
    ["/bank", "bank.view"],
    ["/us-wires", "bank.view"],
    ["/admin", "admin.users"],
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

function requiredPerm(pathname: string): string | null {
  const hit = ROUTE_PERM.find(([prefix]) => pathname.startsWith(prefix));
  return hit ? hit[1] : null;
}

// Primera ruta del menú que el perfil puede ver (para aterrizar tras login o al
// caer en una página bloqueada). null = el perfil no ve nada.
function firstAllowedRoute(perms: string[]): string | null {
  const can = (p?: string) => !p || perms.includes(p);
  for (const n of NAV) {
    if (isGroup(n)) {
      if (can(n.perm)) return n.items[0].href;
    } else if (can(n.perm)) {
      return n.href;
    }
  }
  return null;
}

const isGroup = (n: NavItem): n is { label: string; items: NavLink[] } => "items" in n;

function Dropdown({
  label,
  items,
  pathname,
  open,
  onToggle,
  onClose,
}: {
  label: string;
  items: NavLink[];
  pathname: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const active = items.some((i) => i.href === pathname);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition ${
          active || open ? "bg-white/15 font-medium text-white" : "text-slate-300 hover:bg-white/10"
        }`}
      >
        {label}
        <span className={`text-[9px] transition ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open ? (
        <div className="absolute left-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl">
          {items.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              onClick={onClose}
              className={`block px-3 py-2 ${
                pathname === i.href ? "bg-slate-50" : "hover:bg-slate-50"
              }`}
            >
              <span
                className={`block text-sm ${
                  pathname === i.href ? "font-semibold text-[#2d3a5c]" : "text-slate-700"
                }`}
              >
                {i.label}
              </span>
              {i.hint ? <span className="block text-[11px] text-slate-400">{i.hint}</span> : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Nombre de la pantalla actual, para el encabezado de contexto bajo la barra.
function currentLabel(pathname: string): string | null {
  for (const n of NAV) {
    if (isGroup(n)) {
      const hit = n.items.find((i) => i.href === pathname);
      if (hit) return `${n.label} · ${hit.label}`;
    } else if (n.href === pathname) {
      return n.label;
    }
  }
  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const logout = useLogout();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (me.isError) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [me.isError, router, pathname]);

  // Guard por perfil: si la ruta actual pide un permiso que el perfil no tiene,
  // redirigir a la primera sección que sí puede ver.
  useEffect(() => {
    if (!me.data) return;
    const perms = me.data.permissions ?? [];
    const need = requiredPerm(pathname);
    if (need && !perms.includes(need)) {
      const first = firstAllowedRoute(perms);
      if (first && first !== pathname) router.replace(first);
    }
  }, [me.data, pathname, router]);

  // Cerrar el menú al hacer clic afuera o con Escape (al navegar lo cierra el
  // onClick de cada enlace).
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenMenu(null);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  if (me.isLoading) {
    return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  }
  if (!me.data) return null;

  const perms = me.data.permissions ?? [];
  const can = (p?: string) => !p || perms.includes(p);
  const visibleNav = NAV.filter((n) => can(n.perm));
  const need = requiredPerm(pathname);
  const blocked = need !== null && !perms.includes(need);

  const here = currentLabel(pathname);
  const initials = (me.data.full_name || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 bg-[#2d3a5c] text-white shadow-sm print:hidden">
        <div className="flex items-center gap-4 px-5 py-2">
          {/* Marca */}
          <Link href="/job-cost" className="flex shrink-0 items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white/15 text-sm font-bold">
              V
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold">Dashboard Ventanas</span>
              <span className="block text-[10px] uppercase tracking-wider text-slate-300">
                Project financial control
              </span>
            </span>
          </Link>

          <span className="h-8 w-px shrink-0 bg-white/15" />

          {/* Navegación agrupada */}
          <div ref={navRef} className="flex flex-1 flex-wrap items-center gap-0.5">
            {visibleNav.map((n) =>
              isGroup(n) ? (
                <Dropdown
                  key={n.label}
                  label={n.label}
                  items={n.items}
                  pathname={pathname}
                  open={openMenu === n.label}
                  onToggle={() => setOpenMenu(openMenu === n.label ? null : n.label)}
                  onClose={() => setOpenMenu(null)}
                />
              ) : (
                <Link
                  key={n.href}
                  href={n.href}
                  title={n.hint}
                  onClick={() => setOpenMenu(null)}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${
                    pathname === n.href
                      ? "bg-white/15 font-medium text-white"
                      : "text-slate-300 hover:bg-white/10"
                  }`}
                >
                  {n.label}
                </Link>
              ),
            )}
          </div>

          {/* Usuario */}
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-[11px] font-semibold">
                {initials}
              </span>
              <span className="hidden leading-tight sm:block">
                <span className="block text-xs font-medium">{me.data.full_name}</span>
                <span className="block text-[10px] text-slate-300">{me.data.role}</span>
              </span>
            </div>
            <button
              type="button"
              className="rounded-md border border-white/30 px-3 py-1 text-xs text-white transition hover:bg-white/10"
              onClick={async () => {
                await logout.mutateAsync();
                router.replace("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Dónde estoy */}
      {here ? (
        <div className="border-b border-slate-200 bg-white px-6 py-2 print:hidden">
          <span className="text-sm font-semibold text-slate-700">{here}</span>
        </div>
      ) : null}

      <main className="p-6">
        {blocked ? (
          <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center">
            <p className="text-lg font-semibold text-slate-700">This section is not available</p>
            <p className="mt-1 text-sm text-slate-500">
              Your profile ({me.data.role}) doesn&apos;t include access to this page.
            </p>
          </div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
