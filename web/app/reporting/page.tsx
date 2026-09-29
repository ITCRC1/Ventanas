"use client";

import { AppShell } from "@/components/AppShell";
import { ReportingView } from "@/components/ReportingView";

export default function ReportingPage() {
  return (
    <AppShell>
      <div className="mb-4 print:hidden">
        <h1 className="text-xl font-semibold">Reporting</h1>
        <p className="text-sm text-slate-500">
          Read-only reports built from the database views. Print them or download the full report in
          Excel.
        </p>
      </div>
      <ReportingView />
    </AppShell>
  );
}
