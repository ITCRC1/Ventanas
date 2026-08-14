"use client";

import { AppShell } from "@/components/AppShell";
import { ShortPaymentsView } from "@/components/ShortPaymentsView";

export default function PaymentsPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Short Term Payments</h1>
        <p className="text-sm text-slate-500">
          Payment list by batch (send date), with the bank detail and the total — like the Short
          Payment List in Excel. They are built from Disbursements.
        </p>
      </div>
      <ShortPaymentsView />
    </AppShell>
  );
}
