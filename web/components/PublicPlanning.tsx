"use client";

import type { PlanningNote } from "@/lib/hooks";
import type { WbsFinancials } from "@/lib/types";
import { useCallback, useEffect, useState } from "react";
import { PlanningDoc } from "./PlanningView";

type Bundle = {
  project_name: string | null;
  cutoff_date: string | null;
  comments: string | null;
  weeks: string[];
  financials: WbsFinancials[];
  cells: { wbs_id: number; week_start: string; planned_amount: number | string | null }[];
  notes: PlanningNote[];
};

// Vista PÚBLICA del Planning (sin login), gated por el token de la URL. Reusa
// PlanningDoc; guarda notas/comentarios contra los endpoints /public.
export function PublicPlanning({ token }: { token: string }) {
  const [data, setData] = useState<Bundle | null>(null);
  const [err, setErr] = useState(false);
  const [reviewer, setReviewer] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/public/planning/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("bad");
        return r.json();
      })
      .then((d: Bundle) => setData(d))
      .catch(() => setErr(true));
  }, [token]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: load es estable (useCallback por token)
  useEffect(() => {
    load();
    // Read receipt: avisa que se abrió el link (1 por carga).
    void fetch(`/api/public/planning/${token}/open`, { method: "POST" });
  }, [load]);

  const submitWithComments = () => {
    setSending(true);
    void fetch(`/api/public/planning/${token}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewer_name: reviewer.trim() || null }),
    })
      .then(() => setSent(true))
      .finally(() => setSending(false));
  };

  const saveNote = (
    wbsId: number,
    patch: {
      note?: string | null;
      suggested_amount?: number | null;
      move_to_month?: string | null;
    },
  ) => {
    const cur = (data?.notes ?? []).find((n) => n.wbs_id === wbsId);
    void fetch(`/api/public/planning/${token}/note`, {
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
    void fetch(`/api/public/planning/${token}/comments`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments: c }),
    }).then(load);
  };

  if (err)
    return (
      <div className="p-10 text-center text-slate-500">This link is not valid or has expired.</div>
    );
  if (!data) return <div className="p-10 text-center text-slate-500">Loading…</div>;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Planning — {data.project_name ?? "Ventanas"}</h1>
        <p className="text-sm text-slate-500">
          Review &amp; comment. Your notes and comments are saved automatically. Use 🖨 to print /
          save PDF.
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
        financials={data.financials}
        cells={data.cells}
        weeks={data.weeks}
        cutoffDate={data.cutoff_date ?? ""}
        preparedBy=""
        notes={data.notes}
        comments={data.comments}
        onSaveNote={saveNote}
        onSaveComments={saveComments}
      />
    </div>
  );
}
