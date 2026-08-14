"use client";

import { AppShell } from "@/components/AppShell";
import { UsWiresView } from "@/components/UsWiresView";
import { useMe } from "@/lib/hooks";

export default function UsWiresPage() {
  const me = useMe();
  const canView = me.data?.permissions.includes("bank.view") ?? false;

  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">US Wire Transfers</h1>
        <p className="text-sm text-slate-500">
          Tracking of all the contributions the owners have transferred to the project (USA → Costa
          Rica), by Ventanas I (escrow) and Ventanas II (Disb. Requests).
        </p>
      </div>
      {me.isLoading ? null : canView ? (
        <UsWiresView />
      ) : (
        <p className="text-sm text-amber-600">
          You need the «bank.view» permission to see the transfers.
        </p>
      )}
    </AppShell>
  );
}
