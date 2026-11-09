"use client";

import { AppShell } from "@/components/AppShell";
import { BudgetProposalView } from "@/components/BudgetProposalView";

export default function BudgetProposalPage() {
  return (
    <AppShell>
      <p className="mb-2 text-xs text-slate-500">
        Weekly budget proposal: what the schedule already holds for the milestones, and what the
        LEDGER says the lines paid every month actually cost. Change the year and it recalculates.
      </p>
      <BudgetProposalView />
    </AppShell>
  );
}
