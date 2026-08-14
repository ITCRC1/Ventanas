"""Acceso a datos de la conciliación bancaria (SQL crudo, §DECISIONES).

El log extendido cruza `bank_tx` (movimiento real del banco) con
`ledger_sheet_row` (el pago registrado, réplica del Excel), de donde cuelgan el
# de Short Payment (`src_disb_no`), la factura (`invoice_receipt_link`) y el
proveedor (`invoice_receipt.issuer_name`).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

# Clases que son cargos/ingresos del banco: se auto-concilian, no necesitan
# ni pago del Ledger ni factura.
BANK_CHARGE_CLASSES = ("interest", "transfer_fee", "admin_charge", "fx_charge")


# --- Cuenta y estado (histórico) --------------------------------------------


def resolve_account(db: Session, iban: str | None, name: str | None, currency: str | None) -> int:
    """Ubica la cuenta bancaria por IBAN o nombre; la crea si no existe."""
    if iban:
        row = db.execute(
            text("SELECT id FROM bank_account WHERE iban = :i"), {"i": iban}
        ).scalar_one_or_none()
        if row:
            return int(row)
    row = db.execute(
        text("SELECT id FROM bank_account WHERE name ILIKE '%LAFISE%operativa%' ORDER BY id LIMIT 1")
    ).scalar_one_or_none()
    if row:
        # completa el IBAN si estaba vacío
        if iban:
            db.execute(
                text("UPDATE bank_account SET iban = COALESCE(iban, :i) WHERE id = :id"),
                {"i": iban, "id": row},
            )
        return int(row)
    new_id = db.execute(
        text(
            "INSERT INTO bank_account (name, role, iban, currency) "
            "VALUES (:n, 'operating', :i, :c) RETURNING id"
        ),
        {"n": name or "Ventanas LAFISE (operativa)", "i": iban, "c": (currency or "USD")[:3]},
    ).scalar_one()
    return int(new_id)


def upsert_statement(
    db: Session,
    account_id: int,
    period_from: date | None,
    period_to: date | None,
    filename: str | None,
    source_kind: str,
    opening: Decimal | None,
    closing: Decimal | None,
    n_movements: int,
    n_new: int,
    batch: str,
    user: str | None,
) -> int:
    """Un registro por período: si ya existe uno de ese período, lo actualiza."""
    existing = db.execute(
        text(
            "SELECT id FROM bank_statement "
            "WHERE account_id = :a AND period_from IS NOT DISTINCT FROM :f "
            "AND period_to IS NOT DISTINCT FROM :t ORDER BY id LIMIT 1"
        ),
        {"a": account_id, "f": period_from, "t": period_to},
    ).scalar_one_or_none()
    params = {
        "a": account_id, "f": period_from, "t": period_to, "fn": filename, "sk": source_kind,
        "ob": opening, "cb": closing, "nm": n_movements, "nn": n_new, "b": batch, "u": user,
    }
    if existing:
        db.execute(
            text(
                "UPDATE bank_statement SET filename=:fn, source_kind=:sk, opening_balance=:ob, "
                "closing_balance=:cb, n_movements=:nm, n_new=n_new+:nn, batch=:b, "
                "uploaded_by=:u, uploaded_at=now() WHERE id=:id"
            ),
            {**params, "id": existing},
        )
        return int(existing)
    new_id = db.execute(
        text(
            "INSERT INTO bank_statement (account_id, period_from, period_to, filename, source_kind, "
            "opening_balance, closing_balance, n_movements, n_new, batch, uploaded_by) "
            "VALUES (:a,:f,:t,:fn,:sk,:ob,:cb,:nm,:nn,:b,:u) RETURNING id"
        ),
        params,
    ).scalar_one()
    return int(new_id)


def insert_tx(db: Session, account_id: int, statement_id: int, batch: str, m: Any) -> int:
    """Inserta un movimiento; idempotente por la UNIQUE de bank_tx. rowcount=1 si es nuevo."""
    res = db.execute(
        text(
            "INSERT INTO bank_tx (account_id, tx_date, txn_no, description, debit, credit, balance, "
            "statement_id, import_batch) "
            "VALUES (:a,:d,:n,:desc,:deb,:cr,:bal,:sid,:b) "
            "ON CONFLICT (account_id, tx_date, txn_no, description, debit, credit) DO NOTHING"
        ),
        {
            "a": account_id, "d": m.tx_date, "n": m.txn_no, "desc": m.description,
            "deb": m.debit, "cr": m.credit, "bal": m.balance, "sid": statement_id, "b": batch,
        },
    )
    return res.rowcount


def list_statements(db: Session, account_id: int | None = None) -> list[dict[str, Any]]:
    where = "WHERE s.account_id = :a" if account_id else ""
    rows = db.execute(
        text(
            f"""
            SELECT s.id, s.account_id, a.name AS account, s.period_from, s.period_to,
                   s.filename, s.source_kind, s.opening_balance, s.closing_balance,
                   s.n_movements, s.n_new, s.uploaded_by, s.uploaded_at
              FROM bank_statement s JOIN bank_account a ON a.id = s.account_id
              {where}
             ORDER BY s.period_from DESC NULLS LAST, s.id DESC
            """  # noqa: S608 — where es literal fijo
        ),
        {"a": account_id},
    ).mappings().all()
    return [dict(r) for r in rows]


# --- Log extendido de conciliación ------------------------------------------

_LOG_SQL = """
SELECT
  bt.id, bt.account_id, bt.tx_date, bt.txn_no, bt.description,
  bt.debit, bt.credit, bt.balance, bt.class_code, bt.recon_note, bt.recon_at,
  mc.label AS class_label, mc.is_charge, mc.is_income,
  bt.recon_sheet_row_id,
  lsr.payee            AS ledger_payee,
  lsr.src_disb_no      AS short_payment_no,
  lsr.cost_code        AS ledger_cost_code,
  lsr.account          AS ledger_account,
  lsr.amount_paid      AS ledger_amount_paid,
  lsr.entry_date       AS ledger_date,
  inv.invoice_nos      AS invoice_no,
  inv.providers        AS provider,
  inv.invoice_total    AS invoice_total,
  CASE
    WHEN bt.recon_sheet_row_id IS NOT NULL THEN 'matched'
    WHEN bt.class_code IN ('interest','transfer_fee','admin_charge','fx_charge') THEN 'bank_charge'
    WHEN bt.recon_note IS NOT NULL THEN 'noted'
    ELSE 'unreconciled'
  END AS recon_status,
  (inv.invoice_nos IS NOT NULL) AS has_invoice
FROM bank_tx bt
LEFT JOIN bank_movement_class mc ON mc.code = bt.class_code
LEFT JOIN ledger_sheet_row lsr   ON lsr.id  = bt.recon_sheet_row_id
LEFT JOIN LATERAL (
  SELECT string_agg(DISTINCT ir.invoice_no, ', ')  AS invoice_nos,
         string_agg(DISTINCT ir.issuer_name, ', ') AS providers,
         SUM(COALESCE(ir.total, 0))                AS invoice_total
    FROM invoice_receipt_link irl
    JOIN invoice_receipt ir ON ir.id = irl.receipt_id
   WHERE irl.sheet_row_id = lsr.id
) inv ON true
WHERE bt.account_id = :acc
  {date_filter}
ORDER BY bt.tx_date DESC, bt.id DESC
"""


def reconciliation_log(
    db: Session, account_id: int, dfrom: date | None, dto: date | None
) -> list[dict[str, Any]]:
    df = ""
    params: dict[str, Any] = {"acc": account_id}
    if dfrom:
        df += " AND bt.tx_date >= :df"
        params["df"] = dfrom
    if dto:
        df += " AND bt.tx_date <= :dt"
        params["dt"] = dto
    sql = _LOG_SQL.format(date_filter=df)
    rows = db.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]


def default_account(db: Session) -> int | None:
    row = db.execute(
        text("SELECT id FROM bank_account WHERE name ILIKE '%LAFISE%operativa%' ORDER BY id LIMIT 1")
    ).scalar_one_or_none()
    if row:
        return int(row)
    row = db.execute(text("SELECT id FROM bank_account ORDER BY id LIMIT 1")).scalar_one_or_none()
    return int(row) if row else None


# --- Candidatos del Ledger para un movimiento -------------------------------


def get_tx(db: Session, tx_id: int) -> dict[str, Any] | None:
    row = db.execute(
        text(
            "SELECT id, account_id, tx_date, txn_no, description, debit, credit, class_code, "
            "recon_sheet_row_id FROM bank_tx WHERE id = :id"
        ),
        {"id": tx_id},
    ).mappings().one_or_none()
    return dict(row) if row else None


def candidates(db: Session, tx_id: int, target: Decimal) -> list[dict[str, Any]]:
    """Filas del Ledger (pagos) sin conciliar con monto == target (pagado o comprometido)."""
    rows = db.execute(
        text(
            """
            SELECT lsr.id, lsr.payee, lsr.src_disb_no AS short_payment_no, lsr.cost_code,
                   lsr.account, lsr.amount, lsr.amount_paid, lsr.entry_date, lsr.invoice_no,
                   inv.invoice_nos AS inv_no, inv.providers AS provider
              FROM ledger_sheet_row lsr
              LEFT JOIN LATERAL (
                SELECT string_agg(DISTINCT ir.invoice_no,', ')  AS invoice_nos,
                       string_agg(DISTINCT ir.issuer_name,', ') AS providers
                  FROM invoice_receipt_link irl JOIN invoice_receipt ir ON ir.id = irl.receipt_id
                 WHERE irl.sheet_row_id = lsr.id
              ) inv ON true
             WHERE lsr.kind = 'data'
               AND (ABS(COALESCE(lsr.amount_paid,0) - :t) < 0.01
                    OR ABS(COALESCE(lsr.amount,0) - :t) < 0.01)
               AND lsr.id NOT IN (
                     SELECT recon_sheet_row_id FROM bank_tx
                      WHERE recon_sheet_row_id IS NOT NULL AND id <> :tx)
             ORDER BY lsr.entry_date DESC NULLS LAST, lsr.id DESC
             LIMIT 50
            """
        ),
        {"t": target, "tx": tx_id},
    ).mappings().all()
    return [dict(r) for r in rows]


def set_recon(db: Session, tx_id: int, sheet_row_id: int | None, note: str | None) -> dict[str, Any] | None:
    row = db.execute(
        text(
            # CAST explícito: :r se usa dos veces y puede ser NULL (al desligar) →
            # sin el cast psycopg no puede inferir el tipo del parámetro.
            "UPDATE bank_tx SET recon_sheet_row_id = CAST(:r AS integer), "
            "recon_note = :n, "
            "recon_at = CASE WHEN CAST(:r AS integer) IS NULL THEN NULL ELSE now() END "
            "WHERE id = :id RETURNING id, recon_sheet_row_id, recon_note, recon_at"
        ),
        {"r": sheet_row_id, "n": note, "id": tx_id},
    ).mappings().one_or_none()
    return dict(row) if row else None


def sheet_row_exists(db: Session, sheet_row_id: int) -> bool:
    return (
        db.execute(
            text("SELECT 1 FROM ledger_sheet_row WHERE id = :i"), {"i": sheet_row_id}
        ).scalar_one_or_none()
        is not None
    )


# --- Recap de comisiones MTD / YTD ------------------------------------------


def fees_recap(db: Session, account_id: int, asof: date) -> dict[str, Any]:
    """Suma de cargos/intereses del banco en el mes (MTD) y el año (YTD) del asof."""
    sql = text(
        """
        SELECT
          class_code,
          SUM(CASE WHEN tx_date >= date_trunc('month', :asof)::date AND tx_date <= :asof
                   THEN COALESCE(debit,0)+COALESCE(credit,0) ELSE 0 END) AS mtd,
          SUM(CASE WHEN tx_date >= date_trunc('year', :asof)::date AND tx_date <= :asof
                   THEN COALESCE(debit,0)+COALESCE(credit,0) ELSE 0 END) AS ytd
        FROM bank_tx
        WHERE account_id = :acc AND class_code IN ('interest','transfer_fee','admin_charge','fx_charge')
        GROUP BY class_code
        """
    )
    rows = db.execute(sql, {"acc": account_id, "asof": asof}).mappings().all()
    z = Decimal("0")
    mtd = dict.fromkeys(BANK_CHARGE_CLASSES, z)
    ytd = dict.fromkeys(BANK_CHARGE_CLASSES, z)
    for r in rows:
        mtd[r["class_code"]] = r["mtd"] or z
        ytd[r["class_code"]] = r["ytd"] or z

    def pack(d: dict[str, Decimal]) -> dict[str, Any]:
        charges = d["transfer_fee"] + d["admin_charge"] + d["fx_charge"]
        return {
            "transfer_fee": d["transfer_fee"],
            "admin_charge": d["admin_charge"],
            "fx_charge": d["fx_charge"],
            "interest": d["interest"],
            "total_charges": charges,
            "net": d["interest"] - charges,  # +: los intereses cubren los cargos
        }

    return {"asof": asof, "mtd": pack(mtd), "ytd": pack(ytd)}
