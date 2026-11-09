"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { IssuerInvoicesView } from "@/components/IssuerInvoicesView";
import { VendorBudgetView } from "@/components/VendorBudgetView";
import { TimelineDetail } from "@/components/TimelineDetail";

/** La cédula jurídica de DEHC en Hacienda, para las facturas. */
const DEHC_CEDULA = "3101020869";
/** Cómo está escrito DEHC en la columna Owner del WBS. Es texto a mano, así
 *  que se busca por coincidencia parcial. */
const DEHC_OWNER = "DEHC";

/** Los tres sub-tabs.
 *
 *  Owner, 2026-10-23: *«necesito sub tabs, 1 para las facturas y 2 para el
 *  presupuesto… y otro tab para lo pendiente»*.
 *
 *  Van en ese orden porque es el de la pregunta: qué nos cobraron, contra qué
 *  presupuesto, y qué falta. */
const TABS = [
  { key: "facturas", label: "Invoices", hint: "What DEHC has billed, line by line" },
  { key: "presupuesto", label: "Budget", hint: "What it owns and what was spent on it" },
  { key: "pendiente", label: "Pending", hint: "The schedule of its lines, week by week" },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default function DehcPage() {
  const [tab, setTab] = useState<Tab>("facturas");
  const actual = TABS.find((t) => t.key === tab);

  return (
    <AppShell>
      <div className="mb-3">
        <h1 className="text-xl font-semibold">DEHC</h1>
        <p className="text-sm text-slate-500">{actual?.hint}</p>
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-300">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              tab === t.key
                ? "border-brand-700 font-semibold text-brand-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "facturas" && <IssuerInvoicesView issuer={DEHC_CEDULA} />}
      {tab === "presupuesto" && <VendorBudgetView owner={DEHC_OWNER} />}
      {/* ⚠️ El MISMO cuadro del Timeline Detail, acotado a DEHC (owner,
          2026-10-23: «tal cual pero sólo para esto de DEHC»). Dibujar otro
          parecido daría dos repartos del mismo cronograma, y el día que uno
          se arregle dirían cosas distintas sobre las mismas celdas. */}
      {tab === "pendiente" && <TimelineDetail owner={DEHC_OWNER} />}
    </AppShell>
  );
}
