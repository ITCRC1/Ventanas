"use client";

import { ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import {
  useAddInvoiceLine,
  useCreateInvoice,
  useDeleteInvoice,
  useDeleteInvoiceLine,
  useInvoice,
  useInvoices,
  useMe,
  usePayees,
  useUpdateInvoice,
  useUpdateInvoiceLine,
  useWbsList,
} from "@/lib/hooks";
import type { InvoiceLine } from "@/lib/types";
import { useState } from "react";

interface DraftLine {
  description: string;
  amount: string;
  wbs_id: number | "";
}

const EMPTY_LINE: DraftLine = { description: "", amount: "", wbs_id: "" };

// --- Alta de factura nueva --------------------------------------------------

function NewInvoice() {
  const payees = usePayees();
  const wbs = useWbsList();
  const create = useCreateInvoice();

  const [invoiceNo, setInvoiceNo] = useState("");
  const [payee, setPayee] = useState<number | "">("");
  const [issueDate, setIssueDate] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const valid = invoiceNo && payee && issueDate && lines.some((l) => l.description && l.amount);

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    await create.mutateAsync({
      invoice_no: invoiceNo,
      payee_id: Number(payee),
      issue_date: issueDate,
      lines: lines
        .filter((l) => l.description && l.amount)
        .map((l) => ({
          description: l.description,
          amount: Number(l.amount),
          wbs_id: l.wbs_id === "" ? null : Number(l.wbs_id),
        })),
    });
    setInvoiceNo("");
    setPayee("");
    setIssueDate("");
    setLines([{ ...EMPTY_LINE }]);
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm font-medium">New invoice</p>
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <input
          placeholder="Invoice no."
          className="w-32 rounded border border-slate-300 px-2 py-1"
          value={invoiceNo}
          onChange={(e) => setInvoiceNo(e.target.value)}
        />
        <select
          className="rounded border border-slate-300 px-2 py-1"
          value={payee}
          onChange={(e) => setPayee(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">Payee…</option>
          {(payees.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="rounded border border-slate-300 px-2 py-1"
          value={issueDate}
          onChange={(e) => setIssueDate(e.target.value)}
        />
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-400">
          <tr>
            <th className="py-1">Description</th>
            <th>WBS (allocation)</th>
            <th className="text-right">Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: filas de borrador sin id estable
            <tr key={i}>
              <td className="py-1 pr-2">
                <input
                  className="w-full rounded border border-slate-300 px-2 py-1"
                  placeholder="Line item"
                  value={l.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                />
              </td>
              <td className="pr-2">
                <select
                  className="w-full rounded border border-slate-300 px-2 py-1"
                  value={l.wbs_id}
                  onChange={(e) =>
                    setLine(i, { wbs_id: e.target.value ? Number(e.target.value) : "" })
                  }
                >
                  <option value="">—</option>
                  {(wbs.data ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.wbs_code} · {w.title.slice(0, 24)}
                    </option>
                  ))}
                </select>
              </td>
              <td className="pr-2">
                <input
                  type="number"
                  className="w-24 rounded border border-slate-300 px-2 py-1 text-right"
                  placeholder="0"
                  value={l.amount}
                  onChange={(e) => setLine(i, { amount: e.target.value })}
                />
              </td>
              <td>
                {lines.length > 1 ? (
                  <button
                    type="button"
                    className="text-xs text-red-500 hover:underline"
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                  >
                    remove
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 flex items-center justify-between">
        <button
          type="button"
          className="text-sm text-slate-600 hover:underline"
          onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}
        >
          + add line
        </button>
        <span className="tabular text-sm font-semibold">Total: {money(total)}</span>
      </div>

      <div className="mt-3 border-t border-slate-100 pt-3">
        <button
          type="button"
          className="rounded bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          disabled={!valid || create.isPending}
          onClick={submit}
        >
          Save invoice
        </button>
        {create.error instanceof ApiError ? (
          <p className="mt-2 text-sm text-red-600">
            {create.error.problem.detail ?? create.error.problem.title}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// --- Edición de una línea existente -----------------------------------------

function LineRow({
  invoiceId,
  line,
  canEdit,
  deletable,
}: {
  invoiceId: number;
  line: InvoiceLine;
  canEdit: boolean;
  deletable: boolean;
}) {
  const wbs = useWbsList();
  const updateLine = useUpdateInvoiceLine();
  const deleteLine = useDeleteInvoiceLine();
  const [desc, setDesc] = useState(line.description);
  const [amount, setAmount] = useState(String(line.amount));

  if (!canEdit)
    return (
      <tr>
        <td className="py-1 pr-2">{line.description}</td>
        <td className="pr-2 text-xs text-slate-500">
          {wbs.data?.find((w) => w.id === line.wbs_id)?.wbs_code ?? "—"}
        </td>
        <td className="tabular pr-2 text-right">{money(line.amount)}</td>
        <td />
      </tr>
    );

  return (
    <tr>
      <td className="py-1 pr-2">
        <input
          className="w-full rounded border border-slate-300 px-2 py-1"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() =>
            desc !== line.description &&
            desc.trim() !== "" &&
            updateLine.mutate({ invoiceId, lineId: line.id, description: desc })
          }
        />
      </td>
      <td className="pr-2">
        <select
          className="w-full rounded border border-slate-300 px-2 py-1"
          value={line.wbs_id ?? ""}
          onChange={(e) =>
            updateLine.mutate({
              invoiceId,
              lineId: line.id,
              wbs_id: e.target.value ? Number(e.target.value) : null,
            })
          }
        >
          <option value="">—</option>
          {(wbs.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.wbs_code} · {w.title.slice(0, 24)}
            </option>
          ))}
        </select>
      </td>
      <td className="pr-2">
        <input
          type="number"
          step="0.01"
          className="tabular w-24 rounded border border-slate-300 px-2 py-1 text-right"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onBlur={() => {
            const next = Number(amount || 0);
            if (next !== Number(line.amount))
              updateLine.mutate({ invoiceId, lineId: line.id, amount: next });
          }}
        />
      </td>
      <td>
        {deletable ? (
          <button
            type="button"
            className="text-xs text-red-500 hover:underline disabled:opacity-40"
            disabled={deleteLine.isPending}
            onClick={() => deleteLine.mutate({ invoiceId, lineId: line.id })}
          >
            remove
          </button>
        ) : null}
      </td>
    </tr>
  );
}

// --- Editor de factura existente (cabecera + líneas) ------------------------

function InvoiceEditor({
  id,
  canEdit: canEditPerm,
  onClose,
}: {
  id: number;
  canEdit: boolean;
  onClose: () => void;
}) {
  const detail = useInvoice(id);
  const payees = usePayees();
  const wbs = useWbsList();
  const update = useUpdateInvoice();
  const del = useDeleteInvoice();
  const addLine = useAddInvoiceLine();
  const [newDesc, setNewDesc] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newWbs, setNewWbs] = useState<number | "">("");

  const inv = detail.data;
  if (detail.isLoading || !inv)
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
        Loading invoice…
      </div>
    );

  const err = (update.error ?? del.error ?? addLine.error) as ApiError | null;
  // Una factura anulada queda en el libro pero es read-only (no se edita).
  const voided = inv.status === "void";
  const canEdit = canEditPerm && !voided;

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-medium">
          {voided ? "Invoice" : "Edit invoice"} {inv.invoice_no}
          {voided ? (
            <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
              VOIDED
            </span>
          ) : !canEdit ? (
            <span className="ml-2 text-xs text-slate-400">(read only)</span>
          ) : null}
        </p>
        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={onClose}>
          close
        </button>
      </div>

      {/* Cabecera — INPUTS editables */}
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        <label className="flex flex-col text-xs text-slate-500">
          Invoice no.
          <input
            className="w-32 rounded border border-slate-300 px-2 py-1 text-slate-900 disabled:bg-slate-50"
            defaultValue={inv.invoice_no}
            disabled={!canEdit}
            onBlur={(e) =>
              e.target.value !== inv.invoice_no &&
              e.target.value.trim() !== "" &&
              update.mutate({ id, invoice_no: e.target.value })
            }
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Payee
          <select
            className="rounded border border-slate-300 px-2 py-1 text-slate-900 disabled:bg-slate-50"
            value={inv.payee_id}
            disabled={!canEdit}
            onChange={(e) => update.mutate({ id, payee_id: Number(e.target.value) })}
          >
            {(payees.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Issue date
          <input
            type="date"
            className="rounded border border-slate-300 px-2 py-1 text-slate-900 disabled:bg-slate-50"
            defaultValue={inv.issue_date}
            disabled={!canEdit}
            onChange={(e) =>
              e.target.value &&
              e.target.value !== inv.issue_date &&
              update.mutate({ id, issue_date: e.target.value })
            }
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Due date
          <input
            type="date"
            className="rounded border border-slate-300 px-2 py-1 text-slate-900 disabled:bg-slate-50"
            defaultValue={inv.due_date ?? ""}
            disabled={!canEdit}
            onChange={(e) =>
              update.mutate({ id, due_date: e.target.value === "" ? null : e.target.value })
            }
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Tax
          <input
            type="number"
            step="0.01"
            className="tabular w-24 rounded border border-slate-300 px-2 py-1 text-right text-slate-900 disabled:bg-slate-50"
            defaultValue={inv.tax ?? ""}
            disabled={!canEdit}
            onBlur={(e) => {
              const next = e.target.value === "" ? null : Number(e.target.value);
              if (String(next ?? "") !== String(inv.tax ?? "")) update.mutate({ id, tax: next });
            }}
          />
        </label>
      </div>

      {/* Líneas */}
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-400">
          <tr>
            <th className="py-1">Description</th>
            <th>WBS (allocation)</th>
            <th className="text-right">Amount</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <LineRow
              key={l.id}
              invoiceId={id}
              line={l}
              canEdit={canEdit}
              deletable={inv.lines.length > 1}
            />
          ))}
          {canEdit ? (
            <tr className="border-t border-slate-100">
              <td className="py-1 pr-2">
                <input
                  className="w-full rounded border border-slate-300 px-2 py-1"
                  placeholder="New line…"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </td>
              <td className="pr-2">
                <select
                  className="w-full rounded border border-slate-300 px-2 py-1"
                  value={newWbs}
                  onChange={(e) => setNewWbs(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">—</option>
                  {(wbs.data ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.wbs_code} · {w.title.slice(0, 24)}
                    </option>
                  ))}
                </select>
              </td>
              <td className="pr-2">
                <input
                  type="number"
                  step="0.01"
                  className="tabular w-24 rounded border border-slate-300 px-2 py-1 text-right"
                  placeholder="0"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="text-xs text-slate-600 hover:underline disabled:opacity-40"
                  disabled={!newDesc || !newAmount || addLine.isPending}
                  onClick={async () => {
                    await addLine.mutateAsync({
                      invoiceId: id,
                      description: newDesc,
                      amount: Number(newAmount),
                      wbs_id: newWbs === "" ? null : Number(newWbs),
                    });
                    setNewDesc("");
                    setNewAmount("");
                    setNewWbs("");
                  }}
                >
                  add
                </button>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {/* DERIVADOS — solo lectura, se recalculan al refetch */}
      <div className="mt-3 flex items-center justify-end gap-4 border-t border-slate-100 pt-3 text-sm">
        <span className="text-slate-500">
          Subtotal{" "}
          <span className="tabular font-medium text-slate-700">{money(inv.subtotal ?? 0)}</span>
        </span>
        <span className="text-slate-500">
          Tax <span className="tabular font-medium text-slate-700">{money(inv.tax ?? 0)}</span>
        </span>
        <span className="tabular font-semibold">Total: {money(inv.total)}</span>
      </div>

      {canEdit ? (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <button
            type="button"
            className="rounded border border-red-300 px-3 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
            disabled={del.isPending}
            onClick={async () => {
              if (
                !window.confirm(
                  `Void invoice ${inv.invoice_no}? It stays in the ledger marked as voided.`,
                )
              )
                return;
              await del.mutateAsync(id);
              onClose();
            }}
          >
            Void invoice
          </button>
        </div>
      ) : null}

      {err instanceof ApiError ? (
        <p className="mt-2 text-sm text-red-600">{err.problem.detail ?? err.problem.title}</p>
      ) : null}
    </div>
  );
}

export function InvoicesView() {
  const invoices = useInvoices();
  const payees = usePayees();
  const me = useMe();
  const canEdit = me.data?.permissions.includes("ledger.edit") ?? false;
  const [selected, setSelected] = useState<number | null>(null);

  const payeeName = (id: number) => payees.data?.find((p) => p.id === id)?.name ?? `#${id}`;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <NewInvoice />

        {/* Lista — clic para editar */}
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-600">Registered invoices</p>
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {(invoices.data ?? []).map((inv) => (
              <button
                key={inv.id}
                type="button"
                className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                  selected === inv.id ? "bg-slate-100" : ""
                }`}
                onClick={() => setSelected((s) => (s === inv.id ? null : inv.id))}
              >
                <div className="flex justify-between">
                  <span
                    className={`font-medium ${inv.status === "void" ? "text-slate-400 line-through" : ""}`}
                  >
                    {inv.invoice_no}
                    {inv.status === "void" ? (
                      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 no-underline">
                        VOIDED
                      </span>
                    ) : null}
                  </span>
                  <span className={`tabular ${inv.status === "void" ? "text-slate-400" : ""}`}>
                    {money(inv.total)}
                  </span>
                </div>
                <div className="text-xs text-slate-400">
                  {payeeName(inv.payee_id)} · {inv.issue_date}
                </div>
              </button>
            ))}
            {invoices.data?.length === 0 ? (
              <p className="px-3 py-5 text-center text-sm text-slate-400">No invoices yet.</p>
            ) : null}
          </div>
        </div>
      </div>

      {selected !== null ? (
        <InvoiceEditor id={selected} canEdit={canEdit} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}
