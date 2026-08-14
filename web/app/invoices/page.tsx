"use client";

import { AppShell } from "@/components/AppShell";
import { InvoicesView } from "@/components/InvoicesView";

export default function InvoicesPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Invoices</h1>
        <p className="text-sm text-slate-500">
          Invoice capture with line-item detail and allocation across WBS lines.
        </p>
      </div>
      <InvoicesView />
    </AppShell>
  );
}
