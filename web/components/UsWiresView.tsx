"use client";

import { moneyUsd, num } from "@/lib/format";
import {
  useCreateUsWire,
  useDeleteUsWire,
  useMe,
  useSetLafiseBalance,
  useUpdateUsWire,
  useUsWiresSheet,
} from "@/lib/hooks";
import type { UsWireItem } from "@/lib/types";

const BLOCKS: { key: string; label: string; note: string }[] = [
  {
    key: "ventanas_i",
    label: "Ventanas I",
    note: "Contributions to escrow (Hovde Master → Alta Batalla Escrow)",
  },
  {
    key: "ventanas_ii",
    label: "Ventanas II",
    note: "Disbursement Requests (Hovde Master → SunWest → Escrow)",
  },
];

// --- Celdas editables (guardan al salir del campo) --------------------------

function TextCell({
  value,
  canEdit,
  onSave,
  placeholder,
}: {
  value: string | null;
  canEdit: boolean;
  onSave: (v: string) => void;
  placeholder?: string;
}) {
  if (!canEdit) return <span>{value ?? "—"}</span>;
  return (
    <input
      key={value ?? ""}
      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-slate-300 focus:border-slate-400 focus:bg-white"
      defaultValue={value ?? ""}
      placeholder={placeholder}
      onBlur={(e) => {
        if (e.target.value !== (value ?? "")) onSave(e.target.value);
      }}
    />
  );
}

function DateCell({
  value,
  canEdit,
  onSave,
}: {
  value: string | null;
  canEdit: boolean;
  onSave: (v: string | null) => void;
}) {
  if (!canEdit) return <span className="text-slate-500">{value ?? "—"}</span>;
  return (
    <input
      type="date"
      className="rounded border border-transparent bg-transparent px-1 py-0.5 text-slate-600 hover:border-slate-300 focus:border-slate-400 focus:bg-white"
      value={value ?? ""}
      onChange={(e) => onSave(e.target.value || null)}
    />
  );
}

function AmountCell({
  value,
  canEdit,
  onSave,
  tone,
}: {
  value: string | null;
  canEdit: boolean;
  onSave: (v: number | null) => void;
  tone?: string;
}) {
  if (!canEdit)
    return <span className={`tabular ${tone ?? ""}`}>{value != null ? moneyUsd(value) : "—"}</span>;
  // Se ve con formato de dólares (igual que la columna LAFISE Balance) y al
  // entrar a la celda muestra el número plano para editarlo cómodo.
  const raw = (s: string) => s.replace(/[^0-9.-]/g, "");
  const shown = value != null && value !== "" ? moneyUsd(value) : "";
  return (
    <input
      key={value ?? ""}
      inputMode="decimal"
      className={`tabular w-32 rounded border border-transparent bg-transparent px-1 py-0.5 text-right hover:border-slate-300 focus:border-slate-400 focus:bg-white ${tone ?? ""}`}
      defaultValue={shown}
      onFocus={(e) => {
        e.target.value = value != null && value !== "" ? String(num(value)) : "";
        e.target.select();
      }}
      onBlur={(e) => {
        const s = raw(e.target.value);
        const next = s === "" ? null : Number(s);
        e.target.value = next == null ? "" : moneyUsd(next);
        if (String(next) !== String(value != null ? num(value) : null)) onSave(next);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

export function UsWiresView() {
  const q = useUsWiresSheet();
  const me = useMe();
  const canEdit = me.data?.permissions.includes("bank.view") ?? false;
  const create = useCreateUsWire();
  const update = useUpdateUsWire();
  const del = useDeleteUsWire();
  const setBalance = useSetLafiseBalance();

  if (q.isLoading) return <p className="text-sm text-slate-500">Loading transfers…</p>;
  const data = q.data;
  if (!data) return <p className="text-sm text-slate-500">No data.</p>;

  const rows = data.rows;
  const total = num(data.total_received);
  const totalSent = rows.reduce((s, r) => s + (r.amount_sent != null ? num(r.amount_sent) : 0), 0);
  const save = (id: number, patch: Record<string, unknown>) => update.mutate({ id, ...patch });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">USA to Costa Rica Wire Transfers</h2>
          <p className="text-xs text-slate-500">
            Tracking of all the money the owners have transferred to the project.
          </p>
        </div>
        <div className="flex gap-6 text-right">
          <div>
            <div className="text-[11px] uppercase text-slate-500">Sent by owners</div>
            <div className="tabular text-lg font-bold text-slate-700">{moneyUsd(totalSent)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-slate-500">Received at LAFISE</div>
            <div className="tabular text-2xl font-bold text-emerald-700">{moneyUsd(total)}</div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead className="bg-[#2d3a5c] text-left text-xs uppercase text-white">
            <tr>
              <th className="border border-slate-600 px-2 py-2">Trans #</th>
              <th className="border border-slate-600 px-2 py-2">Date</th>
              <th className="border border-slate-600 px-2 py-2">Sender</th>
              <th className="border border-slate-600 px-2 py-2">From</th>
              <th className="border border-slate-600 px-2 py-2">To</th>
              <th className="border border-slate-600 px-2 py-2">Account</th>
              <th className="border border-slate-600 px-2 py-2 text-right">Sent by owners</th>
              <th className="border border-slate-600 px-2 py-2 text-right">Received LAFISE</th>
              <th className="border border-slate-600 px-2 py-2 text-right">LAFISE Balance</th>
              <th className="border border-slate-600 px-2 py-2">Notes</th>
              {canEdit ? <th className="border border-slate-600 px-2 py-2" /> : null}
            </tr>
          </thead>
          <tbody>
            {BLOCKS.map((b) => {
              const blockRows = rows.filter((r) => r.block === b.key);
              const subtotal = num(data.block_totals[b.key] ?? "0");
              return (
                <BlockRows
                  key={b.key}
                  block={b}
                  rows={blockRows}
                  subtotal={subtotal}
                  canEdit={canEdit}
                  onSave={save}
                  onDelete={(id) => {
                    if (window.confirm("Delete this transfer?")) del.mutate(id);
                  }}
                  onAdd={() => create.mutate({ block: b.key })}
                />
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-800 bg-[#C8DCF0] font-bold">
              <td className="px-2 py-2" colSpan={6}>
                TOTAL TRANSFER
              </td>
              <td className="tabular px-2 py-2 text-right">{moneyUsd(totalSent)}</td>
              <td className="tabular px-2 py-2 text-right">{moneyUsd(total)}</td>
              <td className="tabular px-2 py-2 text-right">{moneyUsd(total)}</td>
              <td className="px-2 py-2" colSpan={canEdit ? 2 : 1} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Saldo actual de la cuenta Ventanas LAFISE (editable) */}
      <div className="mt-3 flex items-center justify-end gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
        <span className="text-sm font-semibold uppercase text-slate-600">LAFISE Balance</span>
        {canEdit ? (
          <input
            key={data.lafise_balance ?? ""}
            type="number"
            step="0.01"
            placeholder="0.00"
            className="tabular w-40 rounded border border-slate-300 px-2 py-1 text-right text-lg font-bold text-slate-800"
            defaultValue={data.lafise_balance != null ? String(num(data.lafise_balance)) : ""}
            onBlur={(e) => {
              const s = e.target.value;
              const next = s === "" ? null : Number(s);
              const cur = data.lafise_balance != null ? num(data.lafise_balance) : null;
              if (String(next) !== String(cur)) setBalance.mutate(next);
            }}
          />
        ) : (
          <span className="tabular text-lg font-bold text-slate-800">
            {data.lafise_balance != null ? moneyUsd(data.lafise_balance) : "—"}
          </span>
        )}
      </div>
    </div>
  );
}

function BlockRows({
  block,
  rows,
  subtotal,
  canEdit,
  onSave,
  onDelete,
  onAdd,
}: {
  block: { key: string; label: string; note: string };
  rows: UsWireItem[];
  subtotal: number;
  canEdit: boolean;
  onSave: (id: number, patch: Record<string, unknown>) => void;
  onDelete: (id: number) => void;
  onAdd: () => void;
}) {
  const cols = canEdit ? 11 : 10;
  return (
    <>
      <tr className="border-t-2 border-slate-400 bg-[#EAF0FA]">
        <td className="px-2 py-1.5 text-[12px] font-bold uppercase text-slate-800" colSpan={cols}>
          {block.label}{" "}
          <span className="ml-2 font-normal normal-case text-slate-500">· {block.note}</span>
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
          <td className="px-2 py-1">
            <TextCell
              value={r.trans_label}
              canEdit={canEdit}
              placeholder="Disb. Request #…"
              onSave={(v) => onSave(r.id, { trans_label: v || null })}
            />
          </td>
          <td className="px-2 py-1">
            <DateCell
              value={r.wire_date}
              canEdit={canEdit}
              onSave={(v) => onSave(r.id, { wire_date: v })}
            />
          </td>
          <td className="px-2 py-1">
            <TextCell
              value={r.sender}
              canEdit={canEdit}
              onSave={(v) => onSave(r.id, { sender: v || null })}
            />
          </td>
          <td className="px-2 py-1">
            <TextCell
              value={r.from_party}
              canEdit={canEdit}
              onSave={(v) => onSave(r.id, { from_party: v || null })}
            />
          </td>
          <td className="px-2 py-1">
            <TextCell
              value={r.to_party}
              canEdit={canEdit}
              onSave={(v) => onSave(r.id, { to_party: v || null })}
            />
          </td>
          <td className="px-2 py-1">
            <TextCell
              value={r.account_number}
              canEdit={canEdit}
              onSave={(v) => onSave(r.id, { account_number: v || null })}
            />
          </td>
          <td className="px-2 py-1 text-right">
            <AmountCell
              value={r.amount_sent}
              canEdit={canEdit}
              tone="text-slate-700"
              onSave={(v) => onSave(r.id, { amount_sent: v })}
            />
          </td>
          <td className="px-2 py-1 text-right">
            <AmountCell
              value={r.amount_received}
              canEdit={canEdit}
              tone="text-emerald-700 font-medium"
              onSave={(v) => onSave(r.id, { amount_received: v })}
            />
          </td>
          <td className="tabular px-2 py-1 text-right text-slate-500">
            {moneyUsd(r.running_balance)}
          </td>
          <td className="px-2 py-1">
            <TextCell
              value={r.notas}
              canEdit={canEdit}
              onSave={(v) => onSave(r.id, { notas: v || null })}
            />
          </td>
          {canEdit ? (
            <td className="px-2 py-1 text-center">
              <button
                type="button"
                className="text-slate-300 hover:text-red-600"
                title="Delete transfer"
                onClick={() => onDelete(r.id)}
              >
                ✕
              </button>
            </td>
          ) : null}
        </tr>
      ))}
      <tr className="border-y border-slate-300 bg-[#DCE6F4] text-[12px] font-semibold">
        <td className="px-2 py-1.5 text-right" colSpan={7}>
          Subtotal {block.label} (received)
        </td>
        <td className="tabular px-2 py-1.5 text-right">{moneyUsd(subtotal)}</td>
        <td className="px-2 py-1.5" colSpan={cols - 8} />
      </tr>
      {canEdit ? (
        <tr>
          <td colSpan={cols} className="px-2 py-1">
            <button
              type="button"
              className="rounded border border-emerald-400 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
              onClick={onAdd}
            >
              ＋ Add transfer to {block.label}
            </button>
          </td>
        </tr>
      ) : null}
    </>
  );
}
