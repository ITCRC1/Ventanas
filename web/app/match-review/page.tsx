"use client";

import { AppShell } from "@/components/AppShell";
import { MatchReview } from "@/components/MatchReview";

export default function MatchReviewPage() {
  return (
    <AppShell>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Match Review</h1>
        <p className="text-sm text-slate-500">
          Medium-confidence invoice ↔ ledger matches, side by side, to validate and apply.
        </p>
      </div>
      <MatchReview />
    </AppShell>
  );
}
