"use client";

import { AppShell } from "@/components/AppShell";
import { BudgetProposalView } from "@/components/BudgetProposalView";

export default function BudgetProposalPage() {
  return (
    <AppShell>
      <p className="mb-2 text-xs text-slate-500">
        Propuesta de presupuesto por semana: lo que el cronograma ya tiene para los hitos, y lo que
        el LEDGER dice que cuestan las líneas que se pagan todos los meses. Cambiá el año y se
        recalcula.
      </p>
      <BudgetProposalView />
    </AppShell>
  );
}
