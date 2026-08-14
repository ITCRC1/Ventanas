"use client";

import { AppShell } from "@/components/AppShell";
import { InvoiceReceipts } from "@/components/InvoiceReceipts";

export default function InvoiceReceiptsPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Invoice Receipts</h1>
        <p className="text-sm text-slate-500">
          Electronic invoices that arrive by email become a line here — associate each one to the
          ledger entry where its disbursement lives.
        </p>
      </div>
      <InvoiceReceipts />
    </AppShell>
  );
}
