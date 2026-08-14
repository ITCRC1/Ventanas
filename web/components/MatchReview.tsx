"use client";

import { type MatchSuggestion, useApplyMatches, useAutomatch, useRefFx } from "@/lib/hooks";
import { useCallback, useEffect, useState } from "react";

const dt = (s: string | null) => (s ? s.slice(0, 10) : "—");
const usd = (n: number | null | undefined) =>
  n == null
    ? "—"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function MatchReview() {
  const automatch = useAutomatch();
  const apply = useApplyMatches();
  const [sug, setSug] = useState<MatchSuggestion[]>([]);
  const [ran, setRan] = useState(false);

  // TC de referencia compartido (guardado en la base).
  const refFx = useRefFx().value;

  // biome-ignore lint/correctness/useExhaustiveDependencies: automatch mutation es estable
  const run = useCallback(() => {
    automatch.mutate(refFx, {
      onSuccess: (d) => {
        setSug(d.suggestions);
        setRan(true);
      },
    });
  }, [refFx]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: correr una vez al montar
  useEffect(() => {
    run();
  }, []);

  // Solo los "más o menos" (review), ordenados por diferencia de monto (menor primero).
  const review = sug
    .filter((s) => s.tier === "review")
    .map((s) => {
      const inv = s.invoice_usd;
      const led = s.ledger_amount_usd != null ? Number(s.ledger_amount_usd) : null;
      const diff = inv != null && led != null ? inv - led : null;
      return { s, inv, led, diff };
    })
    .sort((a, b) => Math.abs(a.diff ?? 1e12) - Math.abs(b.diff ?? 1e12));

  const applyOne = (s: MatchSuggestion) =>
    apply.mutate([{ receipt_id: s.receipt_id, ledger_entry_id: s.ledger_entry_id }], {
      onSuccess: run,
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm">
        <span className="font-medium text-amber-800">
          Matches to review — validate side by side
        </span>
        <span className="text-xs text-amber-700">
          Invoice on the left, ledger disbursement on the right. Sorted by smallest amount
          difference. Reference rate:{" "}
          {refFx ? `₡${refFx}/US$` : "not set (set it in Invoice Receipts)"}.
        </span>
        <button
          type="button"
          onClick={run}
          disabled={automatch.isPending}
          className="ml-auto rounded border border-amber-500 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          {automatch.isPending ? "Scanning…" : "↻ Refresh"}
        </button>
      </div>

      {!ran || automatch.isPending ? (
        <p className="text-sm text-slate-500">Scanning invoices vs ledger…</p>
      ) : review.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nothing to review 🎉 — no medium-confidence matches left.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[1000px] text-xs">
            <thead className="bg-[#0d6b72] text-left uppercase text-white">
              <tr>
                <th className="border-r border-white/20 px-3 py-2">Invoice — issuer / detail</th>
                <th className="px-3 py-2">Ledger — description</th>
                <th className="border-l border-white/20 px-3 py-2 text-right">Invoice USD</th>
                <th className="px-3 py-2 text-right">Ledger USD</th>
                <th className="px-3 py-2 text-right">Difference</th>
                <th className="px-3 py-2">Why</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {review.map(({ s, inv, led, diff }) => (
                <tr key={s.receipt_id} className="align-top hover:bg-slate-50">
                  <td className="border-r border-slate-200 px-3 py-2">
                    <div className="font-medium text-slate-800">{s.issuer_name || "?"}</div>
                    <div className="text-[11px] text-slate-500">
                      #{s.invoice_no || "—"} · {dt(s.invoice_date)} · {s.invoice_total}{" "}
                      {s.invoice_currency}
                    </div>
                  </td>
                  <td className="border-r border-slate-300 px-3 py-2">
                    <div className="font-medium text-slate-800">{s.ledger_desc || ""}</div>
                    <div className="text-[11px] text-slate-500">
                      #{s.ledger_entry_id} · {dt(s.ledger_date)}
                    </div>
                  </td>
                  <td className="tabular px-3 py-2 text-right font-semibold text-slate-700">
                    {usd(inv)}
                  </td>
                  <td className="tabular px-3 py-2 text-right font-semibold text-slate-700">
                    {usd(led)}
                  </td>
                  <td
                    className={`tabular px-3 py-2 text-right font-semibold ${
                      diff == null
                        ? "text-slate-400"
                        : Math.abs(diff) < 1
                          ? "text-emerald-700"
                          : Math.abs(diff) < (led ?? 0) * 0.1
                            ? "text-amber-600"
                            : "text-red-600"
                    }`}
                  >
                    {diff == null ? "—" : usd(diff)}
                  </td>
                  <td className="px-3 py-2">
                    {s.reasons.map((r) => (
                      <span
                        key={r}
                        className="mr-1 inline-block rounded bg-slate-100 px-1 text-[10px] text-slate-600"
                      >
                        {r}
                      </span>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      disabled={apply.isPending}
                      onClick={() => applyOne(s)}
                      className="rounded bg-teal-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                    >
                      Apply
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        Green difference = amounts match; amber = small gap; red = large gap. These are matches by
        payee/date where the amount isn&apos;t exact — apply only the ones you confirm.
      </p>
    </div>
  );
}
