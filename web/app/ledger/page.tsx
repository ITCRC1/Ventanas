"use client";

import { AppShell } from "@/components/AppShell";
import { LedgerView } from "@/components/LedgerView";

export default function LedgerPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">LEDGER</h1>
        <p className="text-sm text-slate-500">
          Project ledger of entries: commitments and payments by Cost Code, with escrow funding
          tracking. A replica of the master's LEDGER sheet.
        </p>
      </div>
      <LedgerView />
    </AppShell>
  );
}
