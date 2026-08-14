"use client";

import { AppShell } from "@/components/AppShell";
import { BankReconciliation } from "@/components/BankReconciliation";
import { useMe } from "@/lib/hooks";

export default function BankReconciliationPage() {
  const me = useMe();
  const canView = me.data?.permissions.includes("bank.view") ?? false;

  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Bank Reconciliation</h1>
        <p className="text-sm text-slate-500">
          Upload the LAFISE statement and match every movement against the Ledger, the Short
          Payment sent by the owner, and its invoice — so every payment has a record and an
          invoice. Unreconciled items and monthly/yearly bank fees are tracked here.
        </p>
      </div>
      {me.isLoading ? null : <BankReconciliation canView={canView} />}
    </AppShell>
  );
}
