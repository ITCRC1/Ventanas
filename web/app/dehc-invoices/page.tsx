"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { IssuerInvoicesView } from "@/components/IssuerInvoicesView";
import { VendorBudgetView } from "@/components/VendorBudgetView";
import { VendorPendingView } from "@/components/VendorPendingView";

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
  { key: "facturas", label: "Facturas", hint: "Lo que DEHC ha cobrado, línea por línea" },
  { key: "presupuesto", label: "Presupuesto", hint: "Lo que tiene a cargo y en qué se gastó" },
  { key: "pendiente", label: "Pendiente", hint: "Lo que falta y cuándo lo espera el cronograma" },
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
      {tab === "pendiente" && <VendorPendingView owner={DEHC_OWNER} />}
    </AppShell>
  );
}
