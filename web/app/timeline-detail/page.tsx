"use client";

import { AppShell } from "@/components/AppShell";
import { TimelineDetail } from "@/components/TimelineDetail";

export default function TimelineDetailPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Timeline Detail</h1>
        <p className="text-sm text-slate-500">
          Schedule by task (WBS): revised budget, spend, remaining, forecast and pending funding by
          line, plus the weekly / monthly / quarterly distribution and the subtotals by category.
        </p>
      </div>
      <TimelineDetail />
    </AppShell>
  );
}
