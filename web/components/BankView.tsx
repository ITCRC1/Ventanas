"use client";

import { ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import {
  useAbsorbWire,
  useAddWireFee,
  useBankAccounts,
  useBankChargesMonthly,
  useBankChargesPending,
  useBankFees,
  useBankFeesByYear,
  useBankStatement,
  useBankUnclassified,
  useClassifyTx,
  useCreateWire,
  useMe,
  useMovementClasses,
  useUpdateBankTx,
  useUpdateWire,
  useUsWireTransfers,
  useWireReconciliation,
} from "@/lib/hooks";
import type {
  BankAccount,
  BankTx,
  BankUnclassified,
  MovementClass,
  UsWireRow,
  WireRecon,
} from "@/lib/types";
import { useState } from "react";

const FEE_TYPES = [
  { code: "sending", label: "Sender (SunWest)" },
  { code: "intermediary", label: "Intermediary (Citibank)" },
  { code: "beneficiary", label: "Beneficiary (LAFISE)" },
  { code: "fx", label: "FX spread" },
  { code: "other", label: "Other" },
];

function pct(v: string | null): string {
  if (v === null) return "—";
  return `${Number(v).toFixed(2)}%`;
}

// --- Celdas de entrada editables (guardan al salir; solo-lectura sin permiso) ----

function TextCell({
  value,
  canEdit,
  onSave,
  align,
  placeholder,
}: {
  value: string | null;
  canEdit: boolean;
  onSave: (v: string) => void;
  align?: "right";
  placeholder?: string;
}) {
  const [v, setV] = useState(value ?? "");
  if (!canEdit)
    return <span className={align === "right" ? "tabular text-right" : ""}>{value ?? "—"}</span>;
  return (
    <input
      className={`w-full rounded border border-slate-200 bg-white px-1 py-0.5 text-xs text-slate-700 ${
        align === "right" ? "tabular text-right" : ""
      }`}
      placeholder={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== (value ?? "") && onSave(v)}
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
  onSave: (v: string) => void;
}) {
  if (!canEdit) return <span className="text-slate-500">{value ?? "—"}</span>;
  return (
    <input
      type="date"
      className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs text-slate-700"
      value={value ?? ""}
      onChange={(e) => e.target.value && e.target.value !== value && onSave(e.target.value)}
    />
  );
}

// Monto editable: cadena con 2 decimales; guarda 0 cuando queda vacío.
function AmountCell({
  value,
  canEdit,
  onSave,
  tone,
}: {
  value: string | null;
  canEdit: boolean;
  onSave: (v: number) => void;
  tone?: "debit" | "credit";
}) {
  const [v, setV] = useState(value != null && Number(value) !== 0 ? String(value) : "");
  const color = tone === "debit" ? "text-red-600" : tone === "credit" ? "text-emerald-700" : "";
  if (!canEdit)
    return (
      <span className={`tabular ${color}`}>{Number(value ?? 0) > 0 ? money(value) : "—"}</span>
    );
  return (
    <input
      type="number"
      step="0.01"
      className={`tabular w-24 rounded border border-slate-200 bg-white px-1 py-0.5 text-right text-xs ${color}`}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const next = v === "" ? 0 : Number(v);
        if (next !== Number(value ?? 0)) onSave(next);
      }}
    />
  );
}

function WireRow({ w, canEdit }: { w: WireRecon; canEdit: boolean }) {
  const addFee = useAddWireFee();
  const absorb = useAbsorbWire();
  const updateWire = useUpdateWire();
  const [open, setOpen] = useState(false);
  const [feeType, setFeeType] = useState("sending");
  const [feeAmount, setFeeAmount] = useState("");
  const sinExplicar = Number(w.sin_explicar ?? 0);

  return (
    <>
      <tr className="hover:bg-slate-50">
        {/* INPUTS del wire: editables */}
        <td className="px-3 py-1.5 text-slate-500">
          <DateCell
            value={w.wire_date}
            canEdit={canEdit}
            onSave={(v) => updateWire.mutate({ wireId: w.id, wire_date: v })}
          />
        </td>
        <td className="px-3 py-1.5 text-slate-500">
          <DateCell
            value={w.value_date}
            canEdit={canEdit}
            onSave={(v) => updateWire.mutate({ wireId: w.id, value_date: v })}
          />
        </td>
        <td className="px-3 py-1.5">
          <TextCell
            value={w.reference}
            canEdit={canEdit}
            placeholder="Ref."
            onSave={(v) => updateWire.mutate({ wireId: w.id, reference: v || null })}
          />
        </td>
        {/* Desembolso y solicitado: derivados → solo lectura */}
        <td className="px-3 py-1.5 text-slate-500">
          {w.disb_no !== null ? `#${w.disb_no}.${w.disb_sub}` : "—"}
        </td>
        <td className="tabular px-3 py-1.5 text-right text-slate-500">
          {w.solicitado !== null ? money(w.solicitado) : "—"}
        </td>
        <td className="px-3 py-1.5 text-right">
          <AmountCell
            value={w.enviado}
            canEdit={canEdit}
            onSave={(v) => updateWire.mutate({ wireId: w.id, amount_sent: v })}
          />
        </td>
        <td
          className={`tabular px-3 py-1.5 text-right ${
            Math.abs(Number(w.dif_solicitado_enviado ?? 0)) > 0.005
              ? "text-amber-600"
              : "text-slate-400"
          }`}
        >
          {w.dif_solicitado_enviado !== null ? money(w.dif_solicitado_enviado) : "—"}
        </td>
        <td className="tabular px-3 py-1.5 text-right">{money(w.comisiones)}</td>
        <td className="tabular px-3 py-1.5 text-right">{money(w.neto_recibido)}</td>
        <td
          className={`tabular px-3 py-1.5 text-right ${sinExplicar > 0.005 ? "font-medium text-amber-600" : "text-slate-400"}`}
        >
          {money(w.sin_explicar)}
        </td>
        <td className="tabular px-3 py-1.5 text-right text-slate-500">{pct(w.pct_comision)}</td>
        <td className="px-3 py-1.5 text-right">
          {sinExplicar > 0.005 ? (
            <button
              type="button"
              className="text-xs text-slate-600 hover:underline"
              onClick={() => setOpen((o) => !o)}
            >
              reconcile
            </button>
          ) : null}
        </td>
      </tr>
      {updateWire.error instanceof ApiError ? (
        <tr className="bg-red-50">
          <td colSpan={12} className="px-3 py-1 text-xs text-red-600">
            {updateWire.error.problem.detail ?? updateWire.error.problem.title}
          </td>
        </tr>
      ) : null}
      {open ? (
        <tr className="bg-slate-50">
          <td colSpan={12} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500">Fee:</span>
              <select
                className="rounded border border-slate-300 px-2 py-1"
                value={feeType}
                onChange={(e) => setFeeType(e.target.value)}
              >
                {FEE_TYPES.map((f) => (
                  <option key={f.code} value={f.code}>
                    {f.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Amount"
                className="w-24 rounded border border-slate-300 px-2 py-1"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
              />
              <button
                type="button"
                className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50"
                disabled={!feeAmount || addFee.isPending}
                onClick={async () => {
                  await addFee.mutateAsync({
                    wireId: w.id,
                    fee_type: feeType,
                    amount: Number(feeAmount),
                  });
                  setFeeAmount("");
                }}
              >
                Add
              </button>
              <span className="mx-2 text-slate-300">|</span>
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1 text-slate-600 hover:bg-white disabled:opacity-50"
                disabled={absorb.isPending}
                onClick={() => absorb.mutate(w.id)}
              >
                Absorb difference ({money(w.sin_explicar)})
              </button>
              {(addFee.error ?? absorb.error) instanceof ApiError ? (
                <span className="w-full text-red-600">
                  {((addFee.error ?? absorb.error) as ApiError).problem.detail}
                </span>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function RegisterWire() {
  const accounts = useBankAccounts();
  const createWire = useCreateWire();
  const [wireDate, setWireDate] = useState("");
  const [valueDate, setValueDate] = useState("");
  const [account, setAccount] = useState<number | "">("");
  const [sent, setSent] = useState("");
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium">Register wire</p>
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col text-xs text-slate-500">
          Wire date
          <input
            type="date"
            className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
            value={wireDate}
            onChange={(e) => setWireDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-xs text-slate-500">
          Value date
          <input
            type="date"
            className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
            value={valueDate}
            onChange={(e) => setValueDate(e.target.value)}
          />
        </label>
        <select
          className="rounded border border-slate-300 px-2 py-1"
          value={account}
          onChange={(e) => setAccount(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">Destination account…</option>
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Sent"
          className="w-28 rounded border border-slate-300 px-2 py-1"
          value={sent}
          onChange={(e) => setSent(e.target.value)}
        />
        <input
          type="number"
          placeholder="Received"
          className="w-28 rounded border border-slate-300 px-2 py-1"
          value={received}
          onChange={(e) => setReceived(e.target.value)}
        />
        <input
          placeholder="Reference"
          className="w-32 rounded border border-slate-300 px-2 py-1"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <button
          type="button"
          className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50"
          disabled={!wireDate || !account || !sent || createWire.isPending}
          onClick={async () => {
            await createWire.mutateAsync({
              wire_date: wireDate,
              value_date: valueDate || null,
              to_account_id: Number(account),
              amount_sent: Number(sent),
              amount_received: received ? Number(received) : null,
              reference: reference || undefined,
            });
            setWireDate("");
            setValueDate("");
            setSent("");
            setReceived("");
            setReference("");
          }}
        >
          Register
        </button>
      </div>
      {createWire.error instanceof ApiError ? (
        <p className="mt-2 text-sm text-red-600">{createWire.error.problem.detail}</p>
      ) : null}
    </div>
  );
}

// Fila EDITABLE del estado de cuenta. INPUTS: fecha, Nº, descripción, débito,
// crédito, cuenta, tipo. El SALDO es derivado (lo recalcula la BD) → solo lectura.
function StatementRow({
  t,
  canEdit,
  accounts,
  classes,
}: {
  t: BankTx;
  canEdit: boolean;
  accounts: BankAccount[];
  classes: MovementClass[];
}) {
  const upd = useUpdateBankTx();
  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-3 py-1.5">
          <DateCell
            value={t.tx_date}
            canEdit={canEdit}
            onSave={(v) => upd.mutate({ txId: t.id, tx_date: v })}
          />
        </td>
        <td className="px-3 py-1.5 text-slate-500">
          <TextCell
            value={t.txn_no}
            canEdit={canEdit}
            placeholder="No."
            onSave={(v) => upd.mutate({ txId: t.id, txn_no: v || null })}
          />
        </td>
        <td className="px-3 py-1.5">
          <TextCell
            value={t.description}
            canEdit={canEdit}
            placeholder="Description"
            onSave={(v) => upd.mutate({ txId: t.id, description: v || null })}
          />
        </td>
        <td className="px-3 py-1.5 text-right">
          <AmountCell
            value={t.debit}
            canEdit={canEdit}
            tone="debit"
            onSave={(v) => upd.mutate({ txId: t.id, debit: v })}
          />
        </td>
        <td className="px-3 py-1.5 text-right">
          <AmountCell
            value={t.credit}
            canEdit={canEdit}
            tone="credit"
            onSave={(v) => upd.mutate({ txId: t.id, credit: v })}
          />
        </td>
        <td className="px-3 py-1.5">
          {canEdit ? (
            <select
              className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs text-slate-700"
              value={t.account_id}
              onChange={(e) => upd.mutate({ txId: t.id, account_id: Number(e.target.value) })}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-slate-500">
              {accounts.find((a) => a.id === t.account_id)?.name ?? `#${t.account_id}`}
            </span>
          )}
        </td>
        <td className="px-3 py-1.5">
          {canEdit ? (
            <select
              className="rounded border border-slate-200 bg-white px-1 py-0.5 text-xs text-slate-700"
              value={t.class_code ?? ""}
              onChange={(e) => upd.mutate({ txId: t.id, class_code: e.target.value })}
            >
              {classes.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-slate-500">
              {classes.find((c) => c.code === t.class_code)?.label ?? "—"}
            </span>
          )}
        </td>
        <td className="tabular px-3 py-1.5 text-right">{money(t.balance ?? 0)}</td>
      </tr>
      {upd.error instanceof ApiError ? (
        <tr className="bg-red-50">
          <td colSpan={8} className="px-3 py-1 text-xs text-red-600">
            {upd.error.problem.detail ?? upd.error.problem.title}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function AccountStatement({ canEdit }: { canEdit: boolean }) {
  const accounts = useBankAccounts();
  const classes = useMovementClasses();
  const [account, setAccount] = useState<number | "">("");
  const statement = useBankStatement(account === "" ? null : account);
  const rows = statement.data ?? [];

  const first = rows[0];
  const last = rows[rows.length - 1];
  const opening =
    first !== undefined
      ? Number(first.balance ?? 0) - (Number(first.credit ?? 0) - Number(first.debit ?? 0))
      : 0;
  const closing = last !== undefined ? Number(last.balance ?? 0) : 0;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold text-slate-600">Account statement</h2>
        <select
          className="rounded border border-slate-300 px-2 py-1 text-sm"
          value={account}
          onChange={(e) => setAccount(e.target.value ? Number(e.target.value) : "")}
        >
          <option value="">Choose account…</option>
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {account !== "" && rows.length > 0 ? (
          <span className="text-xs text-slate-500">
            Opening balance <span className="tabular font-medium">{money(opening)}</span> · Closing
            balance <span className="tabular font-medium">{money(closing)}</span>
          </span>
        ) : null}
      </div>

      {account === "" ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-400">
          Choose an account to see its transactions.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">No.</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length > 0 ? (
                <tr className="bg-slate-50 text-slate-500">
                  <td className="px-3 py-1.5" colSpan={7}>
                    Opening balance
                  </td>
                  <td className="tabular px-3 py-1.5 text-right font-medium">{money(opening)}</td>
                </tr>
              ) : null}
              {rows.map((t) => (
                <StatementRow
                  key={t.id}
                  t={t}
                  canEdit={canEdit}
                  accounts={accounts.data ?? []}
                  classes={classes.data ?? []}
                />
              ))}
              {statement.isSuccess && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                    This account has no transactions.
                  </td>
                </tr>
              ) : null}
              {rows.length > 0 ? (
                <tr className="bg-slate-50 font-medium">
                  <td className="px-3 py-1.5" colSpan={7}>
                    Closing balance
                  </td>
                  <td className="tabular px-3 py-1.5 text-right">{money(closing)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Registro "US Wire Transfers" del Excel: solo lectura, saldo corrido al pie.
function UsWireTransfers() {
  const q = useUsWireTransfers();
  const rows: UsWireRow[] = q.data ?? [];
  const closing = rows.length > 0 ? rows[rows.length - 1].running_balance : "0";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-baseline gap-3">
        <h2 className="text-sm font-semibold text-slate-600">US Wire Transfers</h2>
        <span className="text-xs text-slate-400">
          Hovde Master / SunWest → Escrow · running balance
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Trans #</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Value date</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Destination</th>
              <th className="px-3 py-2">Disb.</th>
              <th className="px-3 py-2">Ref.</th>
              <th className="px-3 py-2 text-right">Sent</th>
              <th className="px-3 py-2 text-right">Received</th>
              <th className="px-3 py-2 text-right">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((w) => (
              <tr key={w.id} className="hover:bg-slate-50">
                <td className="px-3 py-1.5 text-slate-500">{w.trans_no}</td>
                <td className="px-3 py-1.5 text-slate-500">{w.wire_date}</td>
                <td className="px-3 py-1.5 text-slate-500">{w.value_date ?? "—"}</td>
                <td className="px-3 py-1.5">{w.sender}</td>
                <td className="px-3 py-1.5 text-slate-500">{w.to_account}</td>
                <td className="px-3 py-1.5 text-slate-500">
                  {w.disb_no !== null ? `#${w.disb_no}.${w.disb_sub}` : "—"}
                </td>
                <td className="px-3 py-1.5 text-slate-500">{w.reference ?? "—"}</td>
                <td className="tabular px-3 py-1.5 text-right">{money(w.amount_sent)}</td>
                <td className="tabular px-3 py-1.5 text-right text-emerald-700">
                  {w.amount_received !== null ? money(w.amount_received) : "—"}
                </td>
                <td className="tabular px-3 py-1.5 text-right font-medium">
                  {money(w.running_balance)}
                </td>
              </tr>
            ))}
            {q.isSuccess && rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-slate-400">
                  No wires registered.
                </td>
              </tr>
            ) : null}
          </tbody>
          {rows.length > 0 ? (
            <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <tr>
                <td className="px-3 py-1.5" colSpan={9}>
                  LAFISE balance
                </td>
                <td className="tabular px-3 py-1.5 text-right">{money(closing)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

function UnclassifiedRow({ t }: { t: BankUnclassified }) {
  const classes = useMovementClasses();
  const classify = useClassifyTx();
  const [code, setCode] = useState("");

  return (
    <tr className="hover:bg-slate-50">
      <td className="px-3 py-1.5 text-slate-600">{t.cuenta}</td>
      <td className="px-3 py-1.5 text-slate-500">{t.tx_date}</td>
      <td className="px-3 py-1.5">{t.description ?? "—"}</td>
      <td className="tabular px-3 py-1.5 text-right text-red-600">
        {Number(t.debit ?? 0) > 0 ? money(t.debit) : "—"}
      </td>
      <td className="tabular px-3 py-1.5 text-right text-emerald-700">
        {Number(t.credit ?? 0) > 0 ? money(t.credit) : "—"}
      </td>
      <td className="px-3 py-1.5 text-right">
        <div className="flex items-center justify-end gap-2">
          <select
            className="rounded border border-slate-300 px-2 py-1 text-sm"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          >
            <option value="">Classify as…</option>
            {(classes.data ?? []).map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50"
            disabled={!code || classify.isPending}
            onClick={() => classify.mutate({ txId: t.id, class_code: code })}
          >
            Save
          </button>
        </div>
      </td>
    </tr>
  );
}

function UnclassifiedTray() {
  const rows = useBankUnclassified();

  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-600">
        Unclassified transactions (work tray)
      </h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2 text-right">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(rows.data ?? []).map((t) => (
              <UnclassifiedRow key={t.id} t={t} />
            ))}
            {rows.data?.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-5 text-center text-slate-400">
                  All classified — nothing in the tray.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BankFeesPanel() {
  const fees = useBankFees();
  const byYear = useBankFeesByYear();

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-600">How much each bank keeps</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Bank</th>
                <th className="px-3 py-2 text-right">Wires</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Average</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(fees.data ?? []).map((f) => (
                <tr key={`${f.fee_type}-${f.banco}`}>
                  <td className="px-3 py-1.5 text-slate-600">{f.tipo}</td>
                  <td className="px-3 py-1.5 text-slate-500">{f.banco}</td>
                  <td className="tabular px-3 py-1.5 text-right text-slate-500">{f.wires}</td>
                  <td className="tabular px-3 py-1.5 text-right font-medium text-red-600">
                    {money(f.total)}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right text-slate-500">
                    {money(f.promedio)}
                  </td>
                </tr>
              ))}
              {fees.data?.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-5 text-center text-slate-400">
                    No fees registered.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-600">Annual cost of moving money</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Year</th>
                <th className="px-3 py-2 text-right">Wires</th>
                <th className="px-3 py-2 text-right">Sent</th>
                <th className="px-3 py-2 text-right">Fees</th>
                <th className="px-3 py-2 text-right">% fee</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(byYear.data ?? []).map((y) => (
                <tr key={y.anio}>
                  <td className="px-3 py-1.5 text-slate-600">{y.anio}</td>
                  <td className="tabular px-3 py-1.5 text-right text-slate-500">{y.wires}</td>
                  <td className="tabular px-3 py-1.5 text-right">{money(y.enviado)}</td>
                  <td className="tabular px-3 py-1.5 text-right text-red-600">
                    {money(y.comisiones)}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right text-slate-500">{pct(y.pct)}</td>
                </tr>
              ))}
              {byYear.data?.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-5 text-center text-slate-400">
                    No annual data.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function BankView() {
  const me = useMe();
  const canEdit = me.data?.permissions.includes("bank.view") ?? false;
  const recon = useWireReconciliation();
  const charges = useBankChargesMonthly();
  const pending = useBankChargesPending();

  return (
    <div className="space-y-5">
      <RegisterWire />

      <AccountStatement canEdit={canEdit} />

      <UsWireTransfers />

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-600">
          Wire reconciliation (requested → sent → fees → net)
        </h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Value date</th>
                <th className="px-3 py-2">Ref.</th>
                <th className="px-3 py-2">Disb.</th>
                <th className="px-3 py-2 text-right">Requested</th>
                <th className="px-3 py-2 text-right">Sent</th>
                <th className="px-3 py-2 text-right">Diff. req.−sent</th>
                <th className="px-3 py-2 text-right">Fees</th>
                <th className="px-3 py-2 text-right">Net received</th>
                <th className="px-3 py-2 text-right">Unexplained</th>
                <th className="px-3 py-2 text-right">% fee</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(recon.data ?? []).map((w) => (
                <WireRow key={w.id} w={w} canEdit={canEdit} />
              ))}
              {recon.data?.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-6 text-center text-slate-400">
                    No wires registered.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-600">
            Charges and interest by month
          </h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Month</th>
                  <th className="px-3 py-2 text-right">Charges</th>
                  <th className="px-3 py-2 text-right">Interest</th>
                  <th className="px-3 py-2 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(charges.data ?? []).map((c) => (
                  <tr key={`${c.cuenta}-${c.mes}`}>
                    <td className="px-3 py-1.5 text-slate-600">{c.cuenta}</td>
                    <td className="px-3 py-1.5 text-slate-500">{c.mes}</td>
                    <td className="tabular px-3 py-1.5 text-right text-red-600">
                      {money(c.total_cargos)}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right text-emerald-700">
                      {money(c.intereses)}
                    </td>
                    <td className="tabular px-3 py-1.5 text-right">{money(c.neto)}</td>
                  </tr>
                ))}
                {charges.data?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-5 text-center text-slate-400">
                      No charges registered.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold text-slate-600">Charges to recover</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Account</th>
                  <th className="px-3 py-2">Month</th>
                  <th className="px-3 py-2 text-right">Total charges</th>
                  <th className="px-3 py-2 text-right">To recover</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(pending.data ?? []).map((c) => (
                  <tr key={`${c.cuenta}-${c.mes}`}>
                    <td className="px-3 py-1.5 text-slate-600">{c.cuenta}</td>
                    <td className="px-3 py-1.5 text-slate-500">{c.mes}</td>
                    <td className="tabular px-3 py-1.5 text-right">{money(c.total_cargos)}</td>
                    <td className="tabular px-3 py-1.5 text-right font-medium text-amber-600">
                      {money(c.por_recuperar ?? 0)}
                    </td>
                  </tr>
                ))}
                {pending.data?.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-5 text-center text-slate-400">
                      Nothing pending to recover.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <BankFeesPanel />

      <UnclassifiedTray />
    </div>
  );
}
