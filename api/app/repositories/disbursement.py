"""Acceso a datos de desembolsos, payees y recurrentes."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from app.core.holding import HOLDING_BANK
from app.models.disbursement import (
    CreditAdjustment,
    Disbursement,
    DisbursementLine,
    Payee,
    RecurringItem,
)


def list_payees(db: Session, *, only_active: bool = False) -> list[Payee]:
    stmt = select(Payee).order_by(Payee.name)
    if only_active:
        stmt = stmt.where(Payee.is_active.is_(True))
    return list(db.execute(stmt).scalars())


def get_payee(db: Session, payee_id: int) -> Payee | None:
    return db.get(Payee, payee_id)


def list_recurring(db: Session, *, only_active: bool = True) -> list[RecurringItem]:
    stmt = select(RecurringItem).order_by(RecurringItem.label)
    if only_active:
        stmt = stmt.where(RecurringItem.is_active.is_(True))
    return list(db.execute(stmt).scalars())


def active_recurring_for_period(db: Session, period_start: date, period_end: date) -> list[RecurringItem]:
    stmt = (
        select(RecurringItem)
        .where(RecurringItem.is_active.is_(True))
        .where(RecurringItem.active_from <= period_end)
        .where((RecurringItem.active_to.is_(None)) | (RecurringItem.active_to >= period_start))
        # Por id: salen en el orden en que el owner los tiene en la tanda.
        .order_by(RecurringItem.id)
    )
    return list(db.execute(stmt).scalars())


def list_disbursements(db: Session) -> list[Disbursement]:
    return list(
        db.execute(
            select(Disbursement).order_by(Disbursement.disb_no.desc(), Disbursement.disb_sub)
        ).scalars()
    )


def get_disbursement(db: Session, disb_id: int) -> Disbursement | None:
    return db.execute(
        select(Disbursement)
        .options(selectinload(Disbursement.lines))
        .where(Disbursement.id == disb_id)
    ).scalar_one_or_none()


def next_disb_no(db: Session) -> int:
    return int(
        db.execute(
            text("SELECT COALESCE(MAX(disb_no), 0) + 1 FROM disbursement WHERE disb_sub = 0")
        ).scalar_one()
    )


def next_line_no(db: Session, disb_id: int) -> int:
    return int(
        db.execute(
            text(
                "SELECT COALESCE(MAX(line_no), 0) + 1 FROM disbursement_line "
                "WHERE disbursement_id = :d"
            ),
            {"d": disb_id},
        ).scalar_one()
    )


def get_line(db: Session, line_id: int) -> DisbursementLine | None:
    return db.get(DisbursementLine, line_id)


def credit_balance(db: Session) -> dict[str, object]:
    row = db.execute(text("SELECT * FROM v_credit_balance")).mappings().first()
    return dict(row) if row else {"acumulado": 0, "aplicado": 0, "disponible": 0}


def list_adjustments(db: Session) -> list[CreditAdjustment]:
    """Ajustes manuales de crédito, del más reciente al más viejo."""
    return list(
        db.execute(
            select(CreditAdjustment).order_by(
                CreditAdjustment.entry_date.desc(), CreditAdjustment.id.desc()
            )
        ).scalars()
    )


def credit_ledger(db: Session) -> list[dict[str, object]]:
    """Estado de cuenta de crédito con saldo corrido (v_credit_ledger)."""
    rows = db.execute(text("SELECT * FROM v_credit_ledger")).mappings().all()
    return [dict(r) for r in rows]


def short_payments(db: Session) -> list[dict[str, Any]]:
    """Todas las tandas de pago con su detalle bancario (formato Short Payment List).

    WBS (Project Number), Category y Type se resuelven por línea; si la línea no
    trae category/phase propios, se heredan del WBS (misma lógica que el Excel).
    El banco es SIEMPRE el del holding salvo que el proveedor traiga uno propio:
    todo lo que se le pide a corporativo entra a la misma cuenta.
    """
    rows = db.execute(
        text(
            """
            SELECT d.id, d.disb_no, d.disb_sub, d.period_month, d.send_date, d.status,
                   d.total_amount,
                   dl.id AS line_id, dl.line_no, dl.description, dl.invoice_no,
                   dl.amount, dl.reason, dl.transfer,
                   dl.category_id, dl.phase_id,
                   w.wbs_code, w.title AS wbs_title,
                   COALESCE(cl.name, cw.name) AS category,
                   COALESCE(pl.name, pw.name) AS type,
                   p.name AS payee_name,
                   COALESCE(p.bank_name, CASE WHEN dl.id IS NULL THEN NULL ELSE :holding END)
                     AS bank_name,
                   p.legal_id, p.iban
            FROM disbursement d
            LEFT JOIN disbursement_line dl ON dl.disbursement_id = d.id
            LEFT JOIN payee p    ON p.id  = dl.payee_id
            LEFT JOIN wbs_item w ON w.id  = dl.wbs_id
            LEFT JOIN category cl ON cl.id = dl.category_id
            LEFT JOIN phase    pl ON pl.id = dl.phase_id
            LEFT JOIN category cw ON cw.id = w.category_id
            LEFT JOIN phase    pw ON pw.id = w.phase_id
            -- Lo más reciente primero (el owner abre la app en el mes en curso).
            ORDER BY d.disb_no DESC, d.disb_sub DESC, dl.line_no
            """
        ),
        {"holding": HOLDING_BANK},
    ).mappings().all()
    return [dict(r) for r in rows]


def breakdown(db: Session, disb_no: int, disb_sub: int) -> list[dict[str, object]]:
    rows = db.execute(
        text(
            "SELECT * FROM v_breakdown_pdf WHERE disb_no = :n AND disb_sub = :s ORDER BY line_no"
        ),
        {"n": disb_no, "s": disb_sub},
    ).mappings().all()
    return [dict(r) for r in rows]
