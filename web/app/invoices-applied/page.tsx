"use client";

import { AppShell } from "@/components/AppShell";
import { InvoicesApplied } from "@/components/InvoicesApplied";

export default function InvoicesAppliedPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Invoices Applied</h1>
        <p className="text-sm text-slate-500">
          Mirror of the ledger with invoices applied — colones vs USD and the FX differential.
        </p>
      </div>
      <InvoicesApplied />
    </AppShell>
  );
}
