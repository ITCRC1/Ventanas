"use client";

import { AppShell } from "@/components/AppShell";
import { ScheduleGrid } from "@/components/ScheduleGrid";

export default function SchedulePage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Schedule</h1>
        <p className="text-sm text-slate-500">
          Planned amount by week and status. Month and quarter are sums of the weeks (read-only);
          editing is done at the weekly level.
        </p>
      </div>
      <ScheduleGrid />
    </AppShell>
  );
}
