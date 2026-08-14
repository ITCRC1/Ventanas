"use client";

import { ApiError } from "@/lib/api";
import { isNegative, money } from "@/lib/format";
import {
  useCreateAdjustment,
  useCreditAdjustments,
  useCreditBalance,
  useCreditLedger,
  useDeleteAdjustment,
  useMe,
  useUpdateAdjustment,
} from "@/lib/hooks";
import type { CreditAdjustment } from "@/lib/types";
import { useState } from "react";

const KIND_LABEL: Record<string, string> = {
  accrual: "Accrual (released ledger)",
  adjustment: "Manual adjustment",
  application: "Applied to disbursement",
};

const ADJ_CELL = "rounded border border-slate-300 bg-white px-2 py-0.5 text-sm";

// Fila de ajuste manual editable inline. El saldo corrido (derivado) refetchea
// tras cada cambio; si un ajuste sobregira el crédito, la API lo rechaza.
function AdjustmentRow({ adj }: { adj: CreditAdjustment }) {
  const upd = useUpdateAdjustment();
  const del = useDeleteAdjustment();
  const [date, setDate] = useState(adj.entry_date);
  const [amount, setAmount] = useState(adj.amount);
  const [desc, setDesc] = useState(adj.description);

  const revert = (err: unknown) => {
    setDate(adj.entry_date);
    setAmount(adj.amount);
    setDesc(adj.description);
    if (err instanceof ApiError) alert(err.problem.detail ?? err.problem.title);
  };
  const save = (body: { entry_date?: string; amount?: number; description?: string }) =>
    upd.mutate({ id: adj.id, body }, { onError: revert });

  return (
    <tr className="hover:bg-blue-50/40">
      <td className="px-2 py-1">
        <input
          type="date"
          className={ADJ_CELL}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          onBlur={() => date && date !== adj.entry_date && save({ entry_date: date })}
        />
      </td>
      <td className="px-2 py-1">
        <input
          className={`${ADJ_CELL} w-full`}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc.trim() && desc !== adj.description && save({ description: desc })}
        />
      </td>
      <td className="px-2 py-1 text-right">
        <input
          type="number"
          className={`${ADJ_CELL} w-28 text-right ${isNegative(amount) ? "text-red-600" : ""}`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => amount !== adj.amount && save({ amount: Number(amount || 0) })}
        />
      </td>
      <td className="px-2 py-1 text-center">
        <button
          type="button"
          title="Void adjustment"
          className="rounded px-1.5 text-red-600 hover:bg-red-50"
          onClick={() => del.mutate(adj.id, { onError: revert })}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

export function CreditView() {
  const me = useMe();
  const balance = useCreditBalance();
  const ledger = useCreditLedger();
  const adjustments = useCreditAdjustments();
  const addAdj = useCreateAdjustment();

  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");

  const canEdit = me.data?.permissions.includes("disb.create") ?? false;
  const b = balance.data;

  return (
    <div className="space-y-5">
      {/* Saldo */}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Accrued", value: b?.acumulado, tint: "text-slate-900" },
          { label: "Applied", value: b?.aplicado, tint: "text-slate-500" },
          { label: "Available", value: b?.disponible, tint: "text-emerald-700" },
        ].map((c) => (
          <div key={c.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-400">{c.label}</p>
            <p className={`tabular mt-1 text-2xl font-semibold ${c.tint}`}>{money(c.value ?? 0)}</p>
          </div>
        ))}
      </div>

      {/* Ajuste manual */}
      {canEdit ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="mb-2 text-sm font-medium">Register manual adjustment</p>
          <div className="flex flex-wrap items-end gap-2">
            <input
              type="date"
              className="rounded border border-slate-300 px-2 py-1 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <input
              type="number"
              placeholder="Amount (+/−)"
              className="w-32 rounded border border-slate-300 px-2 py-1 text-sm"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              placeholder="Description"
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
            <button
              type="button"
              className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
              disabled={!date || !amount || !desc || addAdj.isPending}
              onClick={async () => {
                await addAdj.mutateAsync({
                  entry_date: date,
                  amount: Number(amount),
                  description: desc,
                });
                setDate("");
                setAmount("");
                setDesc("");
              }}
            >
              Register
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            A positive amount adds to the balance (e.g. a wire surplus); a negative one reduces it.
          </p>
          {addAdj.error instanceof ApiError ? (
            <p className="mt-2 text-sm text-red-600">
              {addAdj.error.problem.detail ?? addAdj.error.problem.title}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Ajustes manuales (editables / anulables) */}
      {canEdit && (adjustments.data?.length ?? 0) > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <p className="border-b border-slate-100 px-3 py-2 text-sm font-medium">
            Manual adjustments
          </p>
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Description</th>
                <th className="px-2 py-2 text-right">Amount</th>
                <th className="px-2 py-2 text-center">Void</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(adjustments.data ?? []).map((a) => (
                <AdjustmentRow key={a.id} adj={a} />
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs text-slate-400">
            Edit or void an adjustment; if the change would push the credit negative, it is
            rejected.
          </p>
        </div>
      ) : null}

      {/* Estado de cuenta (saldo corrido, derivado — solo lectura) */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Movement</th>
              <th className="px-3 py-2">Detail</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(ledger.data ?? []).map((m, i) => (
              <tr key={`${m.move_date}-${i}`}>
                <td className="whitespace-nowrap px-3 py-1.5 text-slate-500">{m.move_date}</td>
                <td className="px-3 py-1.5">{KIND_LABEL[m.kind] ?? m.kind}</td>
                <td className="px-3 py-1.5 text-slate-500">{m.description}</td>
                <td
                  className={`tabular px-3 py-1.5 text-right ${isNegative(m.amount) ? "text-red-600" : "text-emerald-700"}`}
                >
                  {money(m.amount)}
                </td>
                <td className="tabular px-3 py-1.5 text-right font-medium">{money(m.balance)}</td>
              </tr>
            ))}
            {ledger.data?.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  No credit movements yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
