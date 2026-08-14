"""Acceso a datos de bancos y wires."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.bank import BankAccount, WireFee, WireTransfer


def list_accounts(db: Session) -> list[BankAccount]:
    return list(db.execute(select(BankAccount).order_by(BankAccount.name)).scalars())


def list_wires(db: Session) -> list[WireTransfer]:
    return list(
        db.execute(select(WireTransfer).order_by(WireTransfer.wire_date.desc())).scalars()
    )


def get_wire(db: Session, wire_id: int) -> WireTransfer | None:
    return db.get(WireTransfer, wire_id)


def wire_fees(db: Session, wire_id: int) -> list[WireFee]:
    return list(
        db.execute(select(WireFee).where(WireFee.wire_id == wire_id).order_by(WireFee.id)).scalars()
    )


def statement(db: Session, account_id: int) -> list[dict[str, Any]]:
    """Estado de cuenta de una cuenta bancaria: movimientos con saldo corrido.

    Ordena por fecha y luego por id (el orden real del archivo importado, bigserial).
    Usa el saldo del banco (`balance`) cuando existe; si no, calcula el saldo corrido
    como suma acumulada de créditos menos débitos.
    """
    rows = db.execute(
        text(
            """
            SELECT
              id,
              account_id,
              tx_date,
              txn_no,
              description,
              debit,
              credit,
              class_code,
              COALESCE(
                balance,
                SUM(COALESCE(credit, 0) - COALESCE(debit, 0))
                  OVER (ORDER BY tx_date, id ROWS UNBOUNDED PRECEDING)
              ) AS balance
            FROM bank_tx
            WHERE account_id = :account_id
            ORDER BY tx_date, id
            """
        ),
        {"account_id": account_id},
    ).mappings().all()
    return [dict(r) for r in rows]


def _view(db: Session, view: str) -> list[dict[str, Any]]:
    rows = db.execute(text(f"SELECT * FROM {view}")).mappings().all()  # noqa: S608 — nombre fijo
    return [dict(r) for r in rows]


def reconciliation(db: Session) -> list[dict[str, Any]]:
    return _view(db, "v_wire_reconciliation")


def pending(db: Session) -> list[dict[str, Any]]:
    return _view(db, "v_wire_pending")


def fees_summary(db: Session) -> list[dict[str, Any]]:
    return _view(db, "v_bank_fees")


def fees_by_year(db: Session) -> list[dict[str, Any]]:
    return _view(db, "v_bank_fees_by_year")


def charges_monthly(db: Session) -> list[dict[str, Any]]:
    return _view(db, "v_bank_charges_monthly")


def charges_pending(db: Session) -> list[dict[str, Any]]:
    return _view(db, "v_charges_pending_recovery")


def us_wire_transfers(db: Session) -> list[dict[str, Any]]:
    """Registro 'US Wire Transfers' con saldo corrido (v_us_wire_transfers)."""
    return _view(db, "v_us_wire_transfers")


def unclassified(db: Session) -> list[dict[str, Any]]:
    return _view(db, "v_bank_unclassified")


def movement_classes(db: Session) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            "SELECT code, label, is_charge, is_income "
            "FROM bank_movement_class ORDER BY sort_order"
        )
    ).mappings().all()
    return [dict(r) for r in rows]


def class_exists(db: Session, class_code: str) -> bool:
    return (
        db.execute(
            text("SELECT 1 FROM bank_movement_class WHERE code = :c"),
            {"c": class_code},
        ).scalar_one_or_none()
        is not None
    )


def account_exists(db: Session, account_id: int) -> bool:
    return (
        db.execute(
            text("SELECT 1 FROM bank_account WHERE id = :id"),
            {"id": account_id},
        ).scalar_one_or_none()
        is not None
    )


# Columnas de ENTRADA editables de bank_tx. `balance` es derivado → nunca acá.
_TX_EDITABLE = ("tx_date", "txn_no", "description", "debit", "credit", "account_id", "class_code")

_TX_RETURNING = (
    "RETURNING id, account_id, tx_date, txn_no, description, debit, credit, balance, class_code"
)


def get_tx(db: Session, tx_id: int) -> dict[str, Any] | None:
    row = db.execute(
        text(
            "SELECT id, account_id, tx_date, txn_no, description, debit, credit, balance, "
            "class_code FROM bank_tx WHERE id = :id"
        ),
        {"id": tx_id},
    ).mappings().one_or_none()
    return dict(row) if row is not None else None


def classify_tx(db: Session, tx_id: int, class_code: str) -> dict[str, Any] | None:
    """Asigna manualmente el tipo (class_code) a un movimiento de la bandeja."""
    row = db.execute(
        text(
            "UPDATE bank_tx SET class_code = :c WHERE id = :id "
            "RETURNING id, account_id, tx_date, description, debit, credit, class_code"
        ),
        {"c": class_code, "id": tx_id},
    ).mappings().one_or_none()
    return dict(row) if row is not None else None


def update_tx(db: Session, tx_id: int, fields: dict[str, Any]) -> dict[str, Any] | None:
    """Edita los INPUTS de un movimiento (SQL crudo, mismo estilo que classify_tx).

    Solo aplica columnas de la lista blanca `_TX_EDITABLE`; el resto se ignora.
    Devuelve la fila actualizada (con el saldo recalculado por la BD) o None si no existe.
    """
    updates = {k: v for k, v in fields.items() if k in _TX_EDITABLE}
    if not updates:
        return get_tx(db, tx_id)
    set_sql = ", ".join(f"{k} = :{k}" for k in updates)  # claves de lista blanca → sin inyección
    params: dict[str, Any] = dict(updates)
    params["id"] = tx_id
    row = db.execute(
        text(f"UPDATE bank_tx SET {set_sql} WHERE id = :id {_TX_RETURNING}"),  # noqa: S608
        params,
    ).mappings().one_or_none()
    return dict(row) if row is not None else None
