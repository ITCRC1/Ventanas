"use client";

import { AppShell } from "@/components/AppShell";
import { ReconstructedLedger } from "@/components/ReconstructedLedger";

export default function LedgerInvoicesPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Ledger + Invoices</h1>
        <p className="text-sm text-slate-500">
          A copy of the ledger showing only the lines that already have their real invoice
          associated — with invoice #, provider, amount and a note per line.
        </p>
      </div>
      <ReconstructedLedger />
    </AppShell>
  );
}
