"use client";

import { AppShell } from "@/components/AppShell";
import { PlanningView } from "@/components/PlanningView";

export default function PlanningPage() {
  return (
    <AppShell>
      {/* El título ya va en la barra de navegación: acá solo una línea de contexto. */}
      <p className="mb-2 text-xs text-slate-500">
        Upcoming planned expenses (from the Job Cost schedule) by project #, for the months you
        choose — use it to prepare the Short Payments.
      </p>
      <PlanningView />
    </AppShell>
  );
}
