"use client";

import { AppShell } from "@/components/AppShell";
import { JobCostFull } from "@/components/JobCostFull";

export default function JobCostPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Job Cost Report</h1>
        <p className="text-sm text-slate-500">
          Budget, spend, forecast and over/under by line + the timeline (weekly at full detail,
          monthly and quarterly) in the same tab, grouped by category.
        </p>
      </div>
      <JobCostFull />
    </AppShell>
  );
}
