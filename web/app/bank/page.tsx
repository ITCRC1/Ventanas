"use client";

import { AppShell } from "@/components/AppShell";
import { BankView } from "@/components/BankView";
import { useMe } from "@/lib/hooks";

export default function BankPage() {
  const me = useMe();
  const canView = me.data?.permissions.includes("bank.view") ?? false;

  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Banks and wires</h1>
        <p className="text-sm text-slate-500">
          Wire transfer reconciliation (sent vs. net received), bank fees by tier, and account
          charges pending recovery.
        </p>
      </div>
      {me.isLoading ? null : canView ? (
        <BankView />
      ) : (
        <p className="text-sm text-amber-600">
          You need the «bank.view» permission to see the banking data.
        </p>
      )}
    </AppShell>
  );
}
