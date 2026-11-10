"use client";

import { ApiError, api } from "@/lib/api";
import { money, rawNum, usd2 } from "@/lib/format";
import {
  type WbsSuggestion,
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
  useWbsList,
  useWbsSuggestions,
} from "@/lib/hooks";
import type { DisbLine, DisbursementDetail, Payee, Wbs } from "@/lib/types";
import {
  BTN,
  BTN_EXCEL,
  BTN_NEUTRO,
  BTN_PDF,
  BTN_REABRIR,
  CELL,
  ESTADO_ROTULO,
  TH,
  chipEstado,
  rotuloEstado,
} from "@/lib/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

const STATUS_LABEL = ESTADO_ROTULO;

function StatusBadge({ status }: { status: string }) {
  return <span className={chipEstado(status)}>{rotuloEstado(status)}</span>;
}

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

// ⚠️ `usd2` y `rawNum` viven en lib/format: los usa también la pestaña Payments
// y dos copias se separan sin que nadie lo note.

// El # de proyecto de una línea. Owner, 2026-11-10: *«lo unico que falta es el
// # de proyecto»*.
//
// ⚠️ Se escribe el CÓDIGO, no el id: es lo que el dueño reconoce. Un código que
// no existe en el catálogo NO se guarda — se revierte en pantalla y el campo se
// pinta en rojo mientras tanto, porque un WBS inventado manda la plata a una
// línea del Job Cost que nadie va a encontrar.
function WbsField({
  ln,
  wbsList,
  suggestion,
  save,
}: {
  ln: DisbLine;
  wbsList: Wbs[];
  suggestion?: WbsSuggestion;
  save: (body: { wbs_id: number | null }) => void;
}) {
  const [code, setCode] = useState(ln.wbs_code ?? "");
  const match = wbsList.find((w) => w.wbs_code === code.trim());
  // La sugerencia es una propuesta, no un default: solo si la línea sigue vacía.
  const ofrecer = suggestion && !ln.wbs_code && !code.trim();

  return (
    <div className="flex flex-col gap-0.5">
      <input
        list="disb-wbs"
        value={code}
        placeholder="WBS"
        title={match?.title ?? ln.wbs_title ?? "Project number"}
        onChange={(e) => setCode(e.target.value)}
        onBlur={() => {
          const v = code.trim();
          if (v === (ln.wbs_code ?? "")) return;
          if (v === "") return save({ wbs_id: null });
          const w = wbsList.find((x) => x.wbs_code === v);
          if (!w) return setCode(ln.wbs_code ?? ""); // no existe → revertir
          save({ wbs_id: w.id });
        }}
        className={`w-20 rounded border px-1.5 py-0.5 text-center font-mono text-sm ${
          code && !match ? "border-red-300 bg-red-50" : "border-slate-300 bg-white"
        }`}
      />
      {ofrecer && suggestion ? (
        <button
          type="button"
          title={`${suggestion.wbs_title ?? ""} — ${suggestion.reason}. Click to use it.`}
          onClick={() => {
            setCode(suggestion.wbs_code);
            save({ wbs_id: suggestion.wbs_id });
          }}
          className="w-20 rounded bg-amber-100 px-1 py-0.5 font-mono text-xs text-amber-800 hover:bg-amber-200"
        >
          ≈ {suggestion.wbs_code}
        </button>
      ) : null}
    </div>
  );
}

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
  wbsList,
  suggestion,
}: {
  ln: DisbLine;
  disbId: number;
  wbsList: Wbs[];
  suggestion?: WbsSuggestion;
}) {
  const upd = useUpdateLine();
  const del = useDeleteLine();
  const [desc, setDesc] = useState(ln.description);
  const [vendor, setVendor] = useState(ln.vendor ?? "");
  const [nota, setNota] = useState(ln.reason ?? "");
  const [payee, setPayee] = useState(ln.payee_name ?? "");

  const save = (body: Parameters<typeof upd.mutate>[0]["body"]) =>
    upd.mutate({ disbId, lineId: ln.id, body });

  return (
    <tr className="hover:bg-slate-50/60">
      <td className="w-8 px-2 py-1 text-xs text-slate-400">{ln.line_no}</td>
      <td className="px-1">
        <WbsField ln={ln} wbsList={wbsList} suggestion={suggestion} save={save} />
      </td>
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
        {/* Texto libre: se escribe el nombre del beneficiario tal cual va al
            Ledger. El datalist solo sugiere los ya usados; no obliga a elegir. */}
        <input
          className={CELL}
          list="disb-payees"
          placeholder="Beneficiary"
          value={payee}
          onChange={(e) => setPayee(e.target.value)}
          onBlur={() => {
            const nm = payee.trim();
            if (nm !== (ln.payee_name ?? "")) save({ payee_name: nm || null });
          }}
        />
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
  const [linePayee, setLinePayee] = useState("");
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
  // Columnas que abarca la etiqueta del pie: # WBS Desc Vendor Nota Beneficiario.
  const labelCols = 6;

  // El proyecto de cada línea. Owner, 2026-11-10: *«lo unico que falta es el #
  // de proyecto»*. ⚠️ Hoy 216 de 222 líneas lo tienen vacío, así que la columna
  // sola se vería en blanco: por eso trae la MISMA sugerencia que ya usa la
  // pestaña Payments, y se acepta con un clic.
  const wbsList = useWbsList();
  const sug = useWbsSuggestions(d?.id ?? 0, Boolean(d && editable));
  const sugByLine = useMemo(() => {
    const m = new Map<number, WbsSuggestion>();
    for (const x of sug.data ?? []) m.set(x.line_id, x);
    return m;
  }, [sug.data]);
  // Reabrir (des-enviar / des-aprobar) para corregir: aprobado exige aprobar.
  const canReopen =
    (d?.status === "submitted" && canSubmit) || (d?.status === "approved" && canApprove);
  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      {/* Sugerencias para la columna Beneficiary; el campo admite cualquier nombre. */}
      <datalist id="disb-payees">
        {(payees.data ?? []).map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>
      {/* Codigos de proyecto: el valor es el codigo y el rotulo el titulo, para
          que se pueda buscar por cualquiera de los dos. */}
      <datalist id="disb-wbs">
        {(wbsList.data ?? []).map((w) => (
          <option key={w.id} value={w.wbs_code}>
            {w.title}
          </option>
        ))}
      </datalist>
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
                <button
                  type="button"
                  onClick={() => void api.abrir(`/disbursements/${d.id}/breakdown.pdf`)}
                  className={BTN_PDF}
                >
                  Breakdown PDF
                </button>
                <button
                  type="button"
                  onClick={() => void api.abrir(`/disbursements/${d.id}/instruction.pdf`)}
                  className={BTN_PDF}
                >
                  Instruction PDF
                </button>
                <button
                  type="button"
                  onClick={() => void api.abrir(`/disbursements/${d.id}/lines.xlsx`, true)}
                  className={BTN_EXCEL}
                >
                  ⬇ Excel
                </button>
                {editable ? (
                  <label className={`${BTN_EXCEL} cursor-pointer ${uploading ? "opacity-50" : ""}`}>
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
                    className={BTN_REABRIR}
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
                      <th className={TH}>Project</th>
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
                          wbsList={wbsList.data ?? []}
                          suggestion={sugByLine.get(ln.id)}
                        />
                      ) : (
                        <tr key={ln.id} className="hover:bg-slate-50/60">
                          <td className="w-8 px-2 py-1.5 text-xs text-slate-400">{ln.line_no}</td>
                          <td
                            className="px-2 py-1.5 text-center font-mono text-slate-600"
                            title={ln.wbs_title ?? ""}
                          >
                            {ln.wbs_code ?? <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-2 py-1.5 text-slate-700">{ln.description}</td>
                          <td className="px-2 py-1.5 text-slate-500">{ln.vendor ?? ""}</td>
                          <td className="px-2 py-1.5 text-slate-500">{ln.reason ?? ""}</td>
                          <td className="px-2 py-1.5 text-slate-500">{ln.payee_name ?? ""}</td>
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
                      className={BTN_NEUTRO}
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
                    <input
                      className="w-52 rounded border border-slate-300 px-2 py-1 text-sm"
                      list="disb-payees"
                      placeholder="Beneficiary…"
                      value={linePayee}
                      onChange={(e) => setLinePayee(e.target.value)}
                    />
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
                            payee_name: linePayee.trim() || null,
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
