"use client";

import { PrintBar } from "@/components/PrintBar";
import { moneyUsd, num } from "@/lib/format";
import { useFinancials, useInvoicesByWbs, useRefFx } from "@/lib/hooks";
import type { WbsFinancials } from "@/lib/types";
import { useEffect, useMemo, useState } from "react";

const cell = (n: number, opts?: { red?: boolean }) => (
  <span className={n < 0 || opts?.red ? "text-red-600" : undefined}>{moneyUsd(n)}</span>
);

// Compara facturas vs YTD expense de una línea → clase de color.
const matchClass = (inv: number, spend: number) => {
  if (inv <= 0.005) return "text-slate-300";
  if (Math.abs(inv - spend) < 1) return "bg-emerald-50 text-emerald-800 font-semibold";
  return "text-teal-800 font-semibold";
};

// Diferencia YTD Expense − Invoices. Verde=cuadra, ámbar=falta factura, azul=sobra.
const diffCell = (spend: number, inv: number) => {
  const d = spend - inv;
  if (inv <= 0.005) return <span className="text-slate-300">·</span>;
  if (Math.abs(d) < 1)
    return <span className="font-semibold text-emerald-700">✓ {moneyUsd(0)}</span>;
  const cls = d > 0 ? "text-amber-700 font-semibold" : "text-blue-700 font-semibold";
  return <span className={cls}>{moneyUsd(d)}</span>;
};

interface Sums {
  rev: number;
  spend: number;
  inv: number;
  rem: number;
  fc: number;
  funding: number;
}
const zero = (): Sums => ({ rev: 0, spend: 0, inv: 0, rem: 0, fc: 0, funding: 0 });

export function InvoicesApplied() {
  const fin = useFinancials();
  // TC de referencia compartido (guardado en la base).
  const ref = useRefFx();
  const [refStr, setRefStr] = useState("");
  useEffect(() => {
    if (ref.value != null) setRefStr(String(ref.value));
  }, [ref.value]);
  const refFx = refStr ? Number(refStr) : null;
  const byWbs = useInvoicesByWbs(refFx);
  const invOf = (id: number) => byWbs.data?.by_wbs?.[String(id)] ?? 0;

  const groups = useMemo(() => {
    const lines = (fin.data ?? []).filter(
      (r) => r.kind !== "section_header" && r.kind !== "proceeds",
    );
    const map = new Map<string, WbsFinancials[]>();
    for (const r of lines) {
      const k = r.category ?? "Uncategorized";
      (map.get(k) ?? map.set(k, []).get(k))?.push(r);
    }
    const codeKey = (c: string) => c.split(".").map((p) => Number(p) || 0);
    const cmp = (a: WbsFinancials, b: WbsFinancials) => {
      const ka = codeKey(a.wbs_code);
      const kb = codeKey(b.wbs_code);
      for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
        if ((ka[i] ?? 0) !== (kb[i] ?? 0)) return (ka[i] ?? 0) - (kb[i] ?? 0);
      }
      return 0;
    };
    return [...map.entries()]
      .map(([cat, ls]) => ({ cat, ls: [...ls].sort(cmp) }))
      .sort((a, b) => cmp(a.ls[0], b.ls[0]));
  }, [fin.data]);

  const sumsOf = (ls: WbsFinancials[]): Sums => {
    const s = zero();
    for (const r of ls) {
      s.rev += num(r.budget_revised);
      s.spend += num(r.spend);
      s.inv += invOf(r.id);
      s.rem += num(r.remaining);
      s.fc += num(r.forecast);
      s.funding += num(r.forecast) - num(r.spend);
    }
    return s;
  };
  const grand = sumsOf(groups.flatMap((g) => g.ls));

  const TH = "border border-slate-600 bg-[#434343] px-2 py-2 text-[10px] font-semibold uppercase";
  const THR = `${TH} text-right`;

  return (
    <div>
      <PrintBar title="Invoices Applied" subtitle="By project — invoices vs YTD expense" />

      {/* TC de referencia */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm print:hidden">
        <span className="font-medium text-amber-800">Reference rate (₡ per US$):</span>
        <input
          type="number"
          value={refStr}
          onChange={(e) => setRefStr(e.target.value)}
          onBlur={() => {
            const v = refStr === "" ? null : Number(refStr);
            if (v !== ref.value) ref.save.mutate(v);
          }}
          title="Saved for everyone (it lives in the database)"
          placeholder="e.g. 540"
          className="w-28 rounded border border-amber-300 px-2 py-1 text-sm"
        />
        <span className="text-xs text-amber-700">
          Invoices applied per project (₡ converted here). Green = invoices match YTD expense.
        </span>
      </div>

      <div className="max-h-[74vh] overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1120px] border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-[#434343] text-left text-white">
            <tr>
              <th className={TH}>Project Category</th>
              <th className={TH}>Phase</th>
              <th className={TH}>WBS</th>
              <th className={TH}>Task Title</th>
              <th className={TH}>Owner</th>
              <th className={THR}>Budget Revised</th>
              <th className={THR}>YTD Expense</th>
              <th className={`${THR} bg-[#8a5a00]`}>Invoices Applied</th>
              <th className={`${THR} bg-[#8a5a00]`}>Diff (Exp−Inv)</th>
              <th className={THR}>Remaining</th>
              <th className={THR}>Forecast</th>
              <th className={THR}>Funding Pending</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const sub = sumsOf(g.ls);
              return <GroupRows key={g.cat} cat={g.cat} ls={g.ls} sub={sub} invOf={invOf} />;
            })}
          </tbody>
          <tfoot className="sticky bottom-0 z-10">
            <tr className="border-t-2 border-slate-800 bg-[#C8DCF0] font-bold">
              <td className="border border-slate-300 px-2 py-2" colSpan={5}>
                PROJECT TOTAL
              </td>
              <td className="tabular border border-slate-300 px-2 py-2 text-right">
                {cell(grand.rev)}
              </td>
              <td className="tabular border border-slate-300 px-2 py-2 text-right">
                {cell(grand.spend)}
              </td>
              <td
                className={`tabular border border-slate-300 px-2 py-2 text-right ${Math.abs(grand.inv - grand.spend) < 1 && grand.inv > 0 ? "bg-emerald-100 text-emerald-800" : "text-teal-800"}`}
              >
                {cell(grand.inv)}
              </td>
              <td className="tabular border border-slate-300 px-2 py-2 text-right">
                {diffCell(grand.spend, grand.inv)}
              </td>
              <td className="tabular border border-slate-300 px-2 py-2 text-right">
                {cell(grand.rem)}
              </td>
              <td className="tabular border border-slate-300 px-2 py-2 text-right">
                {cell(grand.fc)}
              </td>
              <td className="tabular border border-slate-300 px-2 py-2 text-right">
                {cell(grand.funding, { red: grand.funding < 0 })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        <b>Invoices Applied</b> = invoices matched to each project&apos;s disbursements (₡ converted
        at the reference rate). Cells turn <span className="text-emerald-700">green</span> when the
        invoices equal the YTD expense — i.e. every expense is backed by its invoice.
        {byWbs.data?.missing_rate
          ? ` (${byWbs.data.missing_rate} invoice link(s) not converted — set the reference rate.)`
          : ""}
      </p>
    </div>
  );
}

function GroupRows({
  cat,
  ls,
  sub,
  invOf,
}: {
  cat: string;
  ls: WbsFinancials[];
  sub: Sums;
  invOf: (id: number) => number;
}) {
  return (
    <>
      <tr className="border-t-2 border-slate-400 bg-[#EAF0FA]">
        <td
          className="border border-slate-300 px-2 py-1.5 text-[12px] font-bold uppercase text-slate-800"
          colSpan={12}
        >
          {cat}
        </td>
      </tr>
      {ls.map((r) => {
        const spend = num(r.spend);
        const inv = invOf(r.id);
        const funding = num(r.forecast) - spend;
        return (
          <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="border border-slate-200 px-2 text-slate-500">{r.category ?? ""}</td>
            <td className="border border-slate-200 px-2 text-slate-500">{r.phase ?? ""}</td>
            <td className="whitespace-nowrap border border-slate-200 px-2 font-mono text-[10px] text-slate-500">
              {r.wbs_code}
            </td>
            <td className="border border-slate-200 px-2" title={r.title}>
              {r.title}
            </td>
            <td className="border border-slate-200 px-2 text-slate-500">{r.owner ?? ""}</td>
            <td className="tabular border border-slate-200 px-2 text-right font-medium">
              {cell(num(r.budget_revised))}
            </td>
            <td className="tabular border border-slate-200 px-2 text-right text-slate-600">
              {cell(spend)}
            </td>
            <td
              className={`tabular border border-slate-200 px-2 text-right ${matchClass(inv, spend)}`}
            >
              {inv > 0.005 ? moneyUsd(inv) : "·"}
            </td>
            <td className="tabular border border-slate-200 px-2 text-right">
              {diffCell(spend, inv)}
            </td>
            <td
              className={`tabular border border-slate-200 px-2 text-right ${num(r.remaining) < 0 ? "text-red-600" : ""}`}
            >
              {cell(num(r.remaining))}
            </td>
            <td className="tabular border border-slate-200 px-2 text-right">
              {cell(num(r.forecast))}
            </td>
            <td
              className={`tabular border border-slate-200 px-2 text-right ${funding < 0 ? "text-red-600" : ""}`}
            >
              {cell(funding)}
            </td>
          </tr>
        );
      })}
      <tr className="border-y-2 border-slate-500 bg-[#DCE6F4] text-[12px] font-bold">
        <td className="border border-slate-300 px-2 py-1.5 text-right" colSpan={5}>
          TOTAL {cat}
        </td>
        <td className="tabular border border-slate-300 px-2 text-right">{cell(sub.rev)}</td>
        <td className="tabular border border-slate-300 px-2 text-right">{cell(sub.spend)}</td>
        <td
          className={`tabular border border-slate-300 px-2 text-right ${Math.abs(sub.inv - sub.spend) < 1 && sub.inv > 0 ? "bg-emerald-100 text-emerald-800" : "text-teal-800"}`}
        >
          {cell(sub.inv)}
        </td>
        <td className="tabular border border-slate-300 px-2 text-right">
          {diffCell(sub.spend, sub.inv)}
        </td>
        <td className="tabular border border-slate-300 px-2 text-right">{cell(sub.rem)}</td>
        <td className="tabular border border-slate-300 px-2 text-right">{cell(sub.fc)}</td>
        <td className="tabular border border-slate-300 px-2 text-right">
          {cell(sub.funding, { red: sub.funding < 0 })}
        </td>
      </tr>
    </>
  );
}
