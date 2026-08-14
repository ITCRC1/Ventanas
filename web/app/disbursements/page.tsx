"use client";

import { AppShell } from "@/components/AppShell";
import { DisbursementsView } from "@/components/DisbursementsView";

export default function DisbursementsPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Disbursements (Short Payment)</h1>
        <p className="text-sm text-slate-500">
          Build the month's disbursement with the preloaded recurring items, send it to corporate,
          approve it and generate the Breakdown and Instruction as PDF.
        </p>
      </div>
      <DisbursementsView />
    </AppShell>
  );
}
