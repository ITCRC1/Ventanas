"use client";

import { AppShell } from "@/components/AppShell";
import { Timeline } from "@/components/Timeline";

export default function TimelinePage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Timeline</h1>
        <p className="text-sm text-slate-500">
          Schedule roll-up grouped by category and phase, with a subtotal by category and the FULL
          Year column. Same data as Timeline Detail, aggregated.
        </p>
      </div>
      <Timeline />
    </AppShell>
  );
}
