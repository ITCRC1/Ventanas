"use client";

import { isNegative, money, num } from "@/lib/format";
import {
  useCategories,
  useFinancials,
  useMe,
  usePhases,
  useReassign,
  useSetForecast,
} from "@/lib/hooks";
import type { Category, Phase, WbsFinancials } from "@/lib/types";
import { useMemo, useState } from "react";

const STATE_COLOR: Record<string, string> = {
  not_started: "#94a3b8",
  in_process: "#EAB308",
  approved: "#1155CC",
  attention: "#B85B22",
  completed: "#38761D",
};
const STATE_LABEL: Record<string, string> = {
  not_started: "Not Started",
  in_process: "In process",
  approved: "Approved",
  attention: "Attention",
  completed: "Completed",
};

interface Group {
  category: string;
  lines: WbsFinancials[];
  t: Totals;
}
interface Totals {
  orig: number;
  chg: number;
  rev: number;
  spend: number;
  rem: number;
  fc: number;
  ou: number;
}
const ZERO: Totals = { orig: 0, chg: 0, rev: 0, spend: 0, rem: 0, fc: 0, ou: 0 };
function addTo(t: Totals, r: WbsFinancials): Totals {
  return {
    orig: t.orig + num(r.budget_original),
    chg: t.chg + num(r.budget_change),
    rev: t.rev + num(r.budget_revised),
    spend: t.spend + num(r.spend),
    rem: t.rem + num(r.remaining),
    fc: t.fc + num(r.forecast),
    ou: t.ou + num(r.over_under),
  };
}

function ForecastCell({ r, canEdit }: { r: WbsFinancials; canEdit: boolean }) {
  const setFc = useSetForecast();
  const [val, setVal] = useState<string>(r.forecast);
  if (!canEdit) return <>{money(r.forecast)}</>;
  return (
    <input
      className="tabular w-24 rounded border border-transparent bg-transparent px-1 py-0.5 text-right hover:border-slate-300 focus:border-slate-400 focus:bg-white"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        if (val !== r.forecast) {
          setFc.mutate({ id: r.id, forecast_total: val === "" ? null : Number(val) });
        }
      }}
    />
  );
}

function AssignCell({
  r,
  categories,
  phases,
  canEdit,
}: {
  r: WbsFinancials;
  categories: Category[];
  phases: Phase[];
  canEdit: boolean;
}) {
  const reassign = useReassign();
  const catByName = useMemo(() => new Map(categories.map((c) => [c.name, c])), [categories]);
  const cat = r.category ? catByName.get(r.category) : undefined;
  const catPhases = phases.filter((p) => p.category_id === cat?.id);
  const curPhase = catPhases.find((p) => p.name === r.phase);
  if (!canEdit)
    return (
      <span className="text-slate-500">{r.phase ?? <em className="text-amber-600">—</em>}</span>
    );
  return (
    <select
      className="w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-xs"
      value={curPhase?.id ?? ""}
      disabled={reassign.isPending || !cat}
      onChange={(e) =>
        reassign.mutate({
          id: r.id,
          category_id: cat?.id ?? null,
          phase_id: e.target.value ? Number(e.target.value) : null,
        })
      }
    >
      <option value="">— phase —</option>
      {catPhases.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

const TH = "px-2 py-2 text-[10px] font-semibold uppercase tracking-tight";

export function JobCostGrid() {
  const me = useMe();
  const financials = useFinancials();
  const categories = useCategories();
  const phases = usePhases();
  const canEdit = me.data?.permissions.includes("wbs.edit") ?? false;

  const { groups, grand } = useMemo(() => {
    const rows = (financials.data ?? []).filter((r) => r.kind !== "section_header");
    const map = new Map<string, WbsFinancials[]>();
    for (const r of rows) {
      const cat = r.category ?? "Uncategorized";
      (map.get(cat) ?? map.set(cat, []).get(cat) ?? []).push(r);
    }
    const groups: Group[] = [...map.entries()].map(([category, lines]) => ({
      category,
      lines,
      t: lines.reduce(addTo, ZERO),
    }));
    const grand = rows.reduce(addTo, ZERO);
    return { groups, grand };
  }, [financials.data]);

  if (financials.isLoading) return <p className="text-sm text-slate-500">Loading Job Cost…</p>;

  const cats = categories.data ?? [];
  const phs = phases.data ?? [];
  const money0 = (n: number) => money(n);

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[1180px] border-collapse text-xs">
        <thead className="sticky top-0 bg-[#434343] text-left text-white">
          <tr>
            <th className={TH}>Status</th>
            <th className={TH}>WBS</th>
            <th className={`${TH} min-w-[220px]`}>Task Title</th>
            <th className={TH}>Owner</th>
            <th className={TH}>Phase</th>
            <th className={`${TH} text-right`}>Orig. Budget</th>
            <th className={`${TH} text-right`}>Changes</th>
            <th className={`${TH} text-right`}>Revised</th>
            <th className={`${TH} text-right`}>Spend</th>
            <th className={`${TH} text-right`}>Remaining</th>
            <th className={`${TH} text-right`}>Forecast</th>
            <th className={`${TH} text-right`}>Over/Under</th>
            <th className={`${TH} text-center`}>Draw #</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupBlock
              key={g.category}
              g={g}
              cats={cats}
              phs={phs}
              canEdit={canEdit}
              money0={money0}
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-800 bg-[#C8DCF0] font-bold">
            <td className="px-2 py-2" colSpan={5}>
              PROJECT TOTAL
            </td>
            <td className="tabular px-2 py-2 text-right">{money0(grand.orig)}</td>
            <td className="tabular px-2 py-2 text-right">{money0(grand.chg)}</td>
            <td className="tabular px-2 py-2 text-right">{money0(grand.rev)}</td>
            <td className="tabular px-2 py-2 text-right">{money0(grand.spend)}</td>
            <td className="tabular px-2 py-2 text-right">{money0(grand.rem)}</td>
            <td className="tabular px-2 py-2 text-right">{money0(grand.fc)}</td>
            <td className={`tabular px-2 py-2 text-right ${grand.ou > 0 ? "text-red-700" : ""}`}>
              {money0(grand.ou)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function GroupBlock({
  g,
  cats,
  phs,
  canEdit,
  money0,
}: {
  g: Group;
  cats: Category[];
  phs: Phase[];
  canEdit: boolean;
  money0: (n: number) => string;
}) {
  return (
    <>
      <tr className="bg-[#F8F8F8]">
        <td className="px-2 py-1.5 font-semibold uppercase text-slate-700" colSpan={13}>
          {g.category}
        </td>
      </tr>
      {g.lines.map((r) => (
        <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
          <td className="px-2 py-1">
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: STATE_COLOR[r.state] ?? "#94a3b8" }}
                title={STATE_LABEL[r.state] ?? r.state}
              />
            </span>
          </td>
          <td className="whitespace-nowrap px-2 py-1 font-mono text-[11px] text-slate-500">
            {r.wbs_code}
          </td>
          <td className="px-2 py-1">{r.title}</td>
          <td className="px-2 py-1 text-slate-500">{r.owner ?? ""}</td>
          <td className="px-2 py-1">
            <AssignCell r={r} categories={cats} phases={phs} canEdit={canEdit} />
          </td>
          <td className="tabular px-2 py-1 text-right">{money0(num(r.budget_original))}</td>
          <td className="tabular px-2 py-1 text-right">{money0(num(r.budget_change))}</td>
          <td className="tabular px-2 py-1 text-right font-medium">
            {money0(num(r.budget_revised))}
          </td>
          <td className="tabular px-2 py-1 text-right">{money0(num(r.spend))}</td>
          <td
            className={`tabular px-2 py-1 text-right ${isNegative(r.remaining) ? "font-medium text-red-600" : ""}`}
          >
            {money0(num(r.remaining))}
          </td>
          <td className="px-2 py-1 text-right">
            <ForecastCell r={r} canEdit={canEdit} />
          </td>
          <td
            className={`tabular px-2 py-1 text-right ${num(r.over_under) > 0 ? "font-medium text-red-700" : "text-slate-400"}`}
          >
            {num(r.over_under) !== 0 ? money0(num(r.over_under)) : "—"}
          </td>
          <td className="px-2 py-1 text-center text-slate-500">
            {r.draw_no !== null ? `#${r.draw_no}` : "—"}
          </td>
        </tr>
      ))}
      <tr className="border-y border-slate-300 bg-[#D9D9D9] font-semibold">
        <td className="px-2 py-1.5 text-right" colSpan={5}>
          TOTAL {g.category}
        </td>
        <td className="tabular px-2 py-1.5 text-right">{money0(g.t.orig)}</td>
        <td className="tabular px-2 py-1.5 text-right">{money0(g.t.chg)}</td>
        <td className="tabular px-2 py-1.5 text-right">{money0(g.t.rev)}</td>
        <td className="tabular px-2 py-1.5 text-right">{money0(g.t.spend)}</td>
        <td className="tabular px-2 py-1.5 text-right">{money0(g.t.rem)}</td>
        <td className="tabular px-2 py-1.5 text-right">{money0(g.t.fc)}</td>
        <td className={`tabular px-2 py-1.5 text-right ${g.t.ou > 0 ? "text-red-700" : ""}`}>
          {money0(g.t.ou)}
        </td>
        <td />
      </tr>
    </>
  );
}
