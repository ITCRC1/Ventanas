"use client";

import type { PlanningNote } from "@/lib/hooks";
import type { WbsFinancials } from "@/lib/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PlanningDoc } from "./PlanningView";

type SnapRow = {
  wbs_id: number;
  wbs_code: string;
  title: string | null;
  category: string | null;
  phase: string | null;
  budget_revised: string;
  spend: string;
  remaining: string;
  planned: Record<string, number>;
};
type Pkg = {
  name: string;
  period_from: string | null;
  months: number;
  comments: string | null;
  status: string;
  snapshot: { project_name: string | null; months: string[]; rows: SnapRow[] };
  notes: PlanningNote[];
};

// Vista PÚBLICA de un PAQUETE (foto congelada). Reusa PlanningDoc alimentándolo
// con celdas sintéticas (una por proyecto/mes) reconstruidas del snapshot.
export function PublicPackage({ token }: { token: string }) {
  const [pkg, setPkg] = useState<Pkg | null>(null);
  const [err, setErr] = useState(false);
  const [reviewer, setReviewer] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/public/package/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("bad");
        return r.json();
      })
      .then((d: Pkg) => setPkg(d))
      .catch(() => setErr(true));
  }, [token]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: load es estable (useCallback por token)
  useEffect(() => {
    load();
    // Read receipt: avisa que se abrió el link (1 por carga).
    void fetch(`/api/public/package/${token}/open`, { method: "POST" });
  }, [load]);

  const submitWithComments = () => {
    setSending(true);
    void fetch(`/api/public/package/${token}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewer_name: reviewer.trim() || null }),
    })
      .then(() => setSent(true))
      .finally(() => setSending(false));
  };

  const snap = pkg?.snapshot;
  const financials = useMemo<WbsFinancials[]>(
    () =>
      (snap?.rows ?? []).map((r) => ({
        id: r.wbs_id,
        wbs_code: r.wbs_code,
        title: r.title ?? "",
        owner: null,
        kind: "cost",
        state: "",
        category: r.category,
        phase: r.phase,
        budget_original: "0",
        budget_change: "0",
        budget_revised: r.budget_revised,
        spend: r.spend,
        remaining: r.remaining,
        forecast: "0",
        over_under: "0",
        draw_no: null,
        start_date: null,
        due_date: null,
        duration_days: null,
        draw_no_first: null,
      })),
    [snap],
  );
  const cells = useMemo(
    () =>
      (snap?.rows ?? []).flatMap((r) =>
        Object.entries(r.planned)
          .filter(([, v]) => Math.abs(v) > 0.005)
          .map(([ym, v]) => ({ wbs_id: r.wbs_id, week_start: `${ym}-01`, planned_amount: v })),
      ),
    [snap],
  );
  const weeks = useMemo(() => (snap?.months ?? []).map((m) => `${m}-01`), [snap]);

  const saveNote = (
    wbsId: number,
    patch: {
      note?: string | null;
      suggested_amount?: number | null;
      move_to_month?: string | null;
    },
  ) => {
    const cur = (pkg?.notes ?? []).find((n) => n.wbs_id === wbsId);
    void fetch(`/api/public/package/${token}/note`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wbs_id: wbsId,
        note: patch.note !== undefined ? patch.note || null : (cur?.note ?? null),
        suggested_amount:
          patch.suggested_amount !== undefined
            ? patch.suggested_amount
            : cur?.suggested_amount != null
              ? Number(cur.suggested_amount)
              : null,
        move_to_month:
          patch.move_to_month !== undefined
            ? patch.move_to_month || null
            : (cur?.move_to_month ?? null),
      }),
    }).then(load);
  };
  const saveComments = (c: string) => {
    void fetch(`/api/public/package/${token}/comments`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments: c }),
    }).then(load);
  };

  if (err)
    return (
      <div className="p-10 text-center text-slate-500">This link is not valid or has expired.</div>
    );
  if (!pkg || !snap) return <div className="p-10 text-center text-slate-500">Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">
          {pkg.name} — {snap.project_name ?? "Ventanas"}
        </h1>
        <p className="text-sm text-slate-500">
          Approval package (frozen snapshot). Review &amp; comment — your notes are saved
          automatically. Use 🖨 to print / save PDF.
        </p>
      </div>

      {/* Enviar de vuelta con comentarios (guarda una versión para el emisor) */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 print:hidden">
        {sent ? (
          <span className="text-sm font-medium text-emerald-700">
            ✓ Sent. Thank you — your version with comments was delivered. You can keep editing and
            send again if needed.
          </span>
        ) : (
          <>
            <span className="text-sm text-amber-800">Finished reviewing?</span>
            <input
              className="rounded border border-amber-300 px-2 py-1 text-sm"
              placeholder="Your name (optional)"
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
            />
            <button
              type="button"
              disabled={sending}
              onClick={submitWithComments}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {sending ? "Sending…" : "✉ Send with comments"}
            </button>
            <span className="text-xs text-amber-700">
              Sends your current comments back to the sender.
            </span>
          </>
        )}
      </div>
      <PlanningDoc
        financials={financials}
        cells={cells}
        weeks={weeks}
        cutoffDate={weeks[0] ?? ""}
        preparedBy=""
        notes={pkg.notes}
        comments={pkg.comments}
        onSaveNote={saveNote}
        onSaveComments={saveComments}
        defaultMonths={snap.months.length}
      />
    </div>
  );
}
