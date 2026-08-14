"use client";

import { AppShell } from "@/components/AppShell";
import { DashboardView } from "@/components/DashboardView";

export default function DashboardPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Executive summary: budget vs. spend by category, progress and statuses.
        </p>
      </div>
      <DashboardView />
    </AppShell>
  );
}
