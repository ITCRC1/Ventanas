"use client";

import { AppShell } from "@/components/AppShell";
import { BudgetGridView } from "@/components/BudgetGridView";

export default function BudgetGridPage() {
  return (
    <AppShell>
      <p className="mb-2 text-xs text-slate-500">
        The budget grid: type the year you are planning and read last year beside it, month by
        month. It writes straight to the schedule, with the same rule the Job Cost uses.
      </p>
      <BudgetGridView />
    </AppShell>
  );
}
