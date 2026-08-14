"use client";

import { ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import {
  useAddLine,
  useApplyCredit,
  useApprovals,
  useApproveDisbursement,
  useCreateDisbursement,
  useCreatePayee,
  useCreateRecurring,
  useCreditBalance,
  useDeleteLine,
  useDisbursement,
  useDisbursements,
  useMe,
  usePayees,
  usePreloadRecurring,
  useRecurring,
  useReopenDisbursement,
  useSubmitDisbursement,
  useUpdateDisbursement,
  useUpdateLine,
} from "@/lib/hooks";
import type { DisbLine, DisbursementDetail, Payee } from "@/lib/types";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted to corporate",
  approved: "Approved",
  funded: "Wire received",
  transferred: "Transferred to LAFISE",
  settled: "Settled",
  cancelled: "Cancelled",
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 ring-slate-200",
  submitted: "bg-amber-50 text-amber-700 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  funded: "bg-sky-50 text-sky-700 ring-sky-200",
  transferred: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  settled: "bg-slate-100 text-slate-600 ring-slate-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${
        STATUS_STYLE[status] ?? STATUS_STYLE.draft
      }`}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const BTN = "rounded-md border px-3 py-1.5 text-xs font-medium transition";
const TH = "px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500";

function monthLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
}

function PayeeSetup({ payees }: { payees: Payee[] }) {
  const createPayee = useCreatePayee();
  const createRec = useCreateRecurring();
  const [name, setName] = useState("");
  const [recLabel, setRecLabel] = useState("");
  const [recPayee, setRecPayee] = useState<number | "">("");
  const [recAmount, setRecAmount] = useState("");

  return (
    <details className="rounded-lg border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Setup: beneficiaries and recurring payments
      </summary>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">New beneficiary</p>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="button"
              className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
              disabled={!name || createPayee.isPending}
              onClick={async () => {
                await createPayee.mutateAsync({ name });
                setName("");
              }}
            >
              Add
            </button>
          </div>
          <ul className="mt-2 max-h-28 overflow-auto text-xs text-slate-500">
            {payees.map((p) => (
              <li key={p.id}>· {p.name}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-slate-500">New recurring payment</p>
          <div className="flex flex-wrap gap-2">
            <input
              className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="Concept"
              value={recLabel}
              onChange={(e) => setRecLabel(e.target.value)}
            />
            <select
              className="rounded border border-slate-300 px-2 py-1 text-sm"
              value={recPayee}
              onChange={(e) => setRecPayee(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Beneficiary…</option>
              {payees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="Amount"
              type="number"
              value={recAmount}
              onChange={(e) => setRecAmount(e.target.value)}
            />
            <button
              type="button"
              className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
              disabled={!recLabel || !recPayee || createRec.isPending}
              onClick={async () => {
                await createRec.mutateAsync({
                  label: recLabel,
                  payee_id: Number(recPayee),
                  default_amount: recAmount || null,
                  active_from: "2024-01-01",
                });
                setRecLabel("");
                setRecAmount("");
              }}
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </details>
  );
}

const CELL = "w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-sm";

// Monto con $ y 2 decimales (centrado en la columna Amount, pedido del owner).
const usd2 = (v: string | number | null) => {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  if (Number.isNaN(n)) return "";
  const s = `$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return n < 0 ? `(${s})` : s;
};
const rawNum = (v: string) => v.replace(/[^0-9.-]/g, "");

// Encabezado editable de un desembolso en borrador: período, fecha de envío y
// notas. El número oficial (#) se corrige desde la pestaña Short Payment.
function HeaderEditor({ d }: { d: DisbursementDetail }) {
  const upd = useUpdateDisbursement();
  const [period, setPeriod] = useState(d.period_month.slice(0, 7)); // YYYY-MM
  const [sendDate, setSendDate] = useState(d.send_date ?? "");
  const [notes, setNotes] = useState(d.notes ?? "");

  return (
    <div className="mb-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-3">
      <label className="text-xs text-slate-500">
        Period
        <input
          type="month"
          className={`${CELL} mt-0.5`}
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          onBlur={() => {
            if (period && period !== d.period_month.slice(0, 7))
              upd.mutate({ id: d.id, period_month: `${period}-01` });
          }}
        />
      </label>
      <label className="text-xs text-slate-500">
        Send date
        <input
          type="date"
          className={`${CELL} mt-0.5`}
          value={sendDate}
          onChange={(e) => setSendDate(e.target.value)}
          onBlur={() => {
            if (sendDate !== (d.send_date ?? ""))
              upd.mutate({ id: d.id, send_date: sendDate || null });
          }}
        />
      </label>
      <label className="text-xs text-slate-500">
        Notes
        <input
          className={`${CELL} mt-0.5`}
          placeholder="Batch notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (d.notes ?? "")) upd.mutate({ id: d.id, notes: notes || null });
          }}
        />
      </label>
    </div>
  );
}

// Fila de línea editable inline (borrador). Guarda onBlur; el total lo recomputa
// el trigger de la base y la vista refetchea.
function EditableLineRow({
  ln,
  disbId,
  payees,
}: {
  ln: DisbLine;
  disbId: number;
  payees: Payee[];
}) {
  const upd = useUpdateLine();
  const del = useDeleteLine();
  const [desc, setDesc] = useState(ln.description);
  const [vendor, setVendor] = useState(ln.vendor ?? "");
  const [nota, setNota] = useState(ln.reason ?? "");

  const save = (body: Parameters<typeof upd.mutate>[0]["body"]) =>
    upd.mutate({ disbId, lineId: ln.id, body });

  return (
    <tr className="hover:bg-slate-50/60">
      <td className="w-8 px-2 py-1 text-xs text-slate-400">{ln.line_no}</td>
      <td className="px-1">
        <input
          className={CELL}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc !== ln.description && save({ description: desc })}
        />
      </td>
      <td className="px-1">
        <input
          className={CELL}
          placeholder="Vendor"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          onBlur={() => vendor !== (ln.vendor ?? "") && save({ vendor: vendor || null })}
        />
      </td>
      <td className="px-1">
        <input
          className={CELL}
          placeholder="Note"
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          onBlur={() => nota !== (ln.reason ?? "") && save({ reason: nota || null })}
        />
      </td>
      <td className="px-1">
        <select
          className={CELL}
          value={ln.payee_id ?? ""}
          onChange={(e) => save({ payee_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">—</option>
          {payees.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-1 text-center">
        {/* Muestra $#,##0.00; al enfocar deja el número plano para editarlo. */}
        <input
          key={ln.amount}
          defaultValue={usd2(ln.amount)}
          className={`${CELL} tabular text-center`}
          onFocus={(e) => {
            e.target.value = rawNum(e.target.value);
            e.target.select();
          }}
          onBlur={(e) => {
            const v = rawNum(e.target.value);
            e.target.value = usd2(v === "" ? 0 : v);
            if (Number(v || 0) !== Number(ln.amount)) save({ amount: Number(v || 0) });
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </td>
      <td className="w-10 px-1 text-center">
        <button
          type="button"
          title="Remove line"
          className="rounded px-1.5 text-red-500 hover:bg-red-50"
          onClick={() => del.mutate({ disbId, lineId: ln.id })}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

export function DisbursementsView() {
  const me = useMe();
  const list = useDisbursements();
  const payees = usePayees();
  useRecurring();
  const [selected, setSelected] = useState<number | null>(null);
  const [month, setMonth] = useState("");
  const detail = useDisbursement(selected);

  const create = useCreateDisbursement();
  const preload = usePreloadRecurring();
  const addLine = useAddLine();
  const submit = useSubmitDisbursement();
  const approve = useApproveDisbursement();
  const applyCredit = useApplyCredit();
  const reopen = useReopenDisbursement();
  const creditBalance = useCreditBalance();
  const approvalInfo = useApprovals(selected, detail.data?.status === "submitted");

  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [linePayee, setLinePayee] = useState<number | "">("");
  const [creditAmount, setCreditAmount] = useState("");
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);

  // Subir Excel del Short Payment: reemplaza las líneas del desembolso (borrador).
  async function uploadExcel(id: number, f: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch(`/api/disbursements/${id}/lines/import`, {
        method: "POST",
        body: fd,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(j.detail || "Could not import the Excel file.");
        return;
      }
      qc.invalidateQueries({ queryKey: ["disbursement", id] });
      qc.invalidateQueries({ queryKey: ["disbursements"] });
      alert(`Done: ${j.imported} lines imported from Excel.`);
    } finally {
      setUploading(false);
    }
  }

  const perms = me.data?.permissions ?? [];
  const canCreate = perms.includes("disb.create");
  const canSubmit = perms.includes("disb.submit");
  const canApprove = perms.includes("disb.approve");

  const d = detail.data;
  const isDraft = d?.status === "draft";
  const editable = isDraft && canCreate; // borrador + permiso → edición inline
  // Columnas que abarca la etiqueta del pie: # Desc Vendor Nota Beneficiario.
  const labelCols = 5;
  // Reabrir (des-enviar / des-aprobar) para corregir: aprobado exige aprobar.
  const canReopen =
    (d?.status === "submitted" && canSubmit) || (d?.status === "approved" && canApprove);
  const payeeName = (id: number | null) =>
    id === null ? "" : (payees.data?.find((p) => p.id === id)?.name ?? "");

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      {/* Lista */}
      <div className="space-y-3">
        {canCreate ? (
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <p className="mb-1 text-xs font-medium text-slate-500">New disbursement (month)</p>
            <div className="flex gap-2">
              <input
                type="month"
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              />
              <button
                type="button"
                className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
                disabled={!month || create.isPending}
                onClick={async () => {
                  const res = await create.mutateAsync({ period_month: `${month}-01` });
                  setSelected(res.id);
                  setMonth("");
                }}
              >
                Create
              </button>
            </div>
          </div>
        ) : null}
        <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {(list.data ?? []).map((row) => (
            <button
              type="button"
              key={row.id}
              onClick={() => setSelected(row.id)}
              className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                selected === row.id ? "bg-slate-100" : ""
              }`}
            >
              <div className="flex justify-between">
                <span className="font-medium">
                  #{row.disb_no}.{row.disb_sub}
                </span>
                <span className="tabular text-slate-600">{money(row.total_amount)}</span>
              </div>
              <div className="text-xs text-slate-400">
                {monthLabel(row.period_month)} · {STATUS_LABEL[row.status] ?? row.status}
              </div>
            </button>
          ))}
          {list.data?.length === 0 ? (
            <p className="px-3 py-4 text-sm text-slate-400">No disbursements yet.</p>
          ) : null}
        </div>
      </div>

      {/* Detalle */}
      <div className="space-y-3">
        {payees.data ? <PayeeSetup payees={payees.data} /> : null}

        {!d ? (
          <p className="text-sm text-slate-400">Select or create a disbursement.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            {/* Encabezado del desembolso */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-800">
                    Disbursement #{d.disb_no}.{d.disb_sub}
                  </h2>
                  <StatusBadge status={d.status} />
                </div>
                <p className="text-xs text-slate-500">
                  {monthLabel(d.period_month)} · {d.lines.length} line
                  {d.lines.length === 1 ? "" : "s"} ·{" "}
                  <span className="font-semibold text-slate-700">{usd2(d.total_amount)}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`/api/disbursements/${d.id}/breakdown.pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className={`${BTN} border-emerald-600 text-emerald-700 hover:bg-emerald-50`}
                >
                  Breakdown PDF
                </a>
                <a
                  href={`/api/disbursements/${d.id}/instruction.pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className={`${BTN} border-emerald-600 text-emerald-700 hover:bg-emerald-50`}
                >
                  Instruction PDF
                </a>
                <a
                  href={`/api/disbursements/${d.id}/lines.xlsx`}
                  className={`${BTN} border-indigo-600 text-indigo-700 hover:bg-indigo-50`}
                >
                  ⬇ Excel
                </a>
                {editable ? (
                  <label
                    className={`${BTN} cursor-pointer border-indigo-600 text-indigo-700 hover:bg-indigo-50 ${uploading ? "opacity-50" : ""}`}
                  >
                    {uploading ? "Uploading…" : "⬆ Upload Excel"}
                    <input
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadExcel(d.id, f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                ) : null}
                {/* Corregir algo ya enviado/aprobado: vuelve a borrador. */}
                {canReopen ? (
                  <button
                    type="button"
                    className={`${BTN} border-amber-500 text-amber-700 hover:bg-amber-50`}
                    disabled={reopen.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Reopen #${d.disb_no}.${d.disb_sub} as a draft to correct it?\nThe approvals recorded so far are cleared and it has to be submitted again.`,
                        )
                      )
                        reopen.mutate({ id: d.id });
                    }}
                  >
                    {reopen.isPending ? "Reopening…" : "↩ Reopen (edit)"}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="p-4">
              {editable ? (
                <HeaderEditor d={d} />
              ) : (
                <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  🔒 Locked — the batch is <b>{STATUS_LABEL[d.status] ?? d.status}</b>.
                  {canReopen ? " Use “↩ Reopen (edit)” to correct it." : ""}
                </div>
              )}

              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-100 text-left">
                    <tr>
                      <th className={TH}>#</th>
                      <th className={TH}>Description</th>
                      <th className={TH}>Vendor</th>
                      <th className={TH}>Note</th>
                      <th className={TH}>Beneficiary</th>
                      <th className={`${TH} text-center`}>Amount</th>
                      {editable ? <th className={TH} /> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.lines.map((ln) =>
                      editable ? (
                        <EditableLineRow
                          key={ln.id}
                          ln={ln}
                          disbId={d.id}
                          payees={payees.data ?? []}
                        />
                      ) : (
                        <tr key={ln.id} className="hover:bg-slate-50/60">
                          <td className="w-8 px-2 py-1.5 text-xs text-slate-400">{ln.line_no}</td>
                          <td className="px-2 py-1.5 text-slate-700">{ln.description}</td>
                          <td className="px-2 py-1.5 text-slate-500">{ln.vendor ?? ""}</td>
                          <td className="px-2 py-1.5 text-slate-500">{ln.reason ?? ""}</td>
                          <td className="px-2 py-1.5 text-slate-500">{payeeName(ln.payee_id)}</td>
                          <td className="tabular px-2 py-1.5 text-center">{usd2(ln.amount)}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                    {Number(d.credit_applied) > 0 ? (
                      <tr className="text-emerald-700">
                        <td colSpan={labelCols} className="px-2 py-1.5 text-right">
                          Credit applied
                        </td>
                        <td className="tabular px-2 py-1.5 text-center">
                          ({usd2(d.credit_applied)})
                        </td>
                        {editable ? <td /> : null}
                      </tr>
                    ) : null}
                    <tr>
                      <td colSpan={labelCols} className="px-2 py-1.5 text-right">
                        TOTAL
                      </td>
                      <td className="tabular px-2 py-1.5 text-center">{usd2(d.total_amount)}</td>
                      {editable ? <td /> : null}
                    </tr>
                  </tfoot>
                </table>
              </div>

              {isDraft && canCreate ? (
                <div className="mt-4 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <button
                      type="button"
                      className={`${BTN} border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}
                      disabled={preload.isPending}
                      title="Brings the 4 fixed monthly lines (Development Team, Admin Fee + FC, CCSS, Alexi)"
                      onClick={() => preload.mutate({ id: d.id })}
                    >
                      ↺ Preload recurring
                    </button>
                    <span className="ml-auto text-xs text-slate-400">
                      Available credit: {money(creditBalance.data?.disponible ?? 0)}
                    </span>
                    <input
                      type="number"
                      className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="Apply credit"
                      value={creditAmount}
                      onChange={(e) => setCreditAmount(e.target.value)}
                    />
                    <button
                      type="button"
                      className="rounded border border-emerald-600 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                      disabled={!creditAmount || applyCredit.isPending}
                      onClick={async () => {
                        await applyCredit.mutateAsync({
                          disbId: d.id,
                          amount: Number(creditAmount),
                        });
                        setCreditAmount("");
                      }}
                    >
                      Apply credit
                    </button>
                  </div>
                  <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                    <input
                      className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="Line description"
                      value={desc}
                      onChange={(e) => setDesc(e.target.value)}
                    />
                    <select
                      className="rounded border border-slate-300 px-2 py-1 text-sm"
                      value={linePayee}
                      onChange={(e) => setLinePayee(e.target.value ? Number(e.target.value) : "")}
                    >
                      <option value="">Beneficiary…</option>
                      {(payees.data ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="Amount"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <button
                      type="button"
                      className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
                      disabled={!desc || !amount || addLine.isPending}
                      onClick={async () => {
                        await addLine.mutateAsync({
                          id: d.id,
                          body: {
                            description: desc,
                            amount: Number(amount),
                            payee_id: linePayee ? Number(linePayee) : null,
                          },
                        });
                        setDesc("");
                        setAmount("");
                        setLinePayee("");
                      }}
                    >
                      + Line
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                {isDraft && canSubmit ? (
                  <button
                    type="button"
                    className="rounded bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
                    disabled={submit.isPending || d.lines.length === 0}
                    onClick={() => submit.mutate({ id: d.id })}
                  >
                    Submit to corporate
                  </button>
                ) : null}
                {d.status === "submitted" && canApprove ? (
                  <button
                    type="button"
                    className="rounded bg-emerald-700 px-4 py-1.5 text-sm text-white disabled:opacity-50"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate({ id: d.id })}
                  >
                    Approve
                  </button>
                ) : null}
              </div>

              {d.status === "submitted" && approvalInfo.data ? (
                <div className="mt-2 text-xs text-slate-500">
                  {approvalInfo.data.needed > 1 ? (
                    <span className="font-medium text-amber-600">
                      Dual approval: {approvalInfo.data.approved_count} of{" "}
                      {approvalInfo.data.needed} (amount &gt; {money(approvalInfo.data.threshold)}).{" "}
                    </span>
                  ) : null}
                  {approvalInfo.data.approvals.length > 0
                    ? `Approved by: ${approvalInfo.data.approvals.map((a) => a.full_name).join(", ")}.`
                    : "No approvals yet."}
                </div>
              ) : null}

              {(() => {
                const err = [
                  submit.error,
                  approve.error,
                  addLine.error,
                  preload.error,
                  applyCredit.error,
                  reopen.error,
                ].find((e) => e instanceof ApiError);
                return err instanceof ApiError ? (
                  <p className="mt-2 text-sm text-red-600">
                    {err.problem.detail ?? err.problem.title}
                  </p>
                ) : null;
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
