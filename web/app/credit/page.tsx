"use client";

import { AppShell } from "@/components/AppShell";
import { CreditView } from "@/components/CreditView";

export default function CreditPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Credit account</h1>
        <p className="text-sm text-slate-500">
          Credit balance with a running statement. The credit comes from released payments and
          manual adjustments, and is applied to disbursements.
        </p>
      </div>
      <CreditView />
    </AppShell>
  );
}
