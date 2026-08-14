"""Lógica del Short Payment.

Los bloqueos por estado y el recálculo de totales/crédito son de la base
(triggers disb_lines_locked, disb_recalc_total, sync_credit_applied,
credit_not_overdrawn). Aquí sólo orquestamos y traducimos errores.
"""

from __future__ import annotations

import calendar
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.problems import Problem
from app.deps import CurrentUser
from app.models.disbursement import (
    CreditAdjustment,
    CreditApplication,
    Disbursement,
    DisbursementApproval,
    DisbursementLine,
    Payee,
    RecurringItem,
)
from app.repositories import disbursement as repo
from app.schemas.disbursement import (
    AdjustmentIn,
    AdjustmentUpdate,
    DisbursementIn,
    DisbursementPatch,
    LineIn,
    LineUpdate,
    PayeeIn,
    RecurringIn,
)


def _month_bounds(d: date) -> tuple[date, date]:
    first = d.replace(day=1)
    last = d.replace(day=calendar.monthrange(d.year, d.month)[1])
    return first, last


# --- Payees / recurrentes ---------------------------------------------------


def create_payee(db: Session, data: PayeeIn) -> Payee:
    payee = Payee(**data.model_dump())
    db.add(payee)
    db.flush()
    return payee


def create_recurring(db: Session, data: RecurringIn) -> RecurringItem:
    if repo.get_payee(db, data.payee_id) is None:
        raise Problem(status_code=404, title="Payee no encontrado")
    item = RecurringItem(**data.model_dump())
    db.add(item)
    db.flush()
    return item


# --- Desembolsos ------------------------------------------------------------


def disb_no_for_period(period: date) -> int:
    """Numeración mensual de los Short Payments, anclada por el owner:
    Enero-2026 = #19, Agosto-2026 = #26 (un número por mes consecutivo)."""
    return 19 + (period.year - 2026) * 12 + (period.month - 1)


def create_disbursement(db: Session, data: DisbursementIn) -> Disbursement:
    period = data.period_month.replace(day=1)
    # El número sale del mes (regla del owner); se puede overridear con data.disb_no.
    disb_no = data.disb_no or disb_no_for_period(period)
    # Una tanda por mes: si ya existe, se avisa claro en vez de reventar por el
    # UNIQUE(disb_no, disb_sub).
    clash = db.execute(
        select(Disbursement).where(Disbursement.disb_no == disb_no, Disbursement.disb_sub == 0)
    ).scalars().first()
    if clash is not None:
        raise Problem(
            status_code=409,
            title="Esa tanda ya existe",
            detail=f"Ya hay un Disbursement #{disb_no} "
            f"({clash.period_month:%B %Y}); abrilo en vez de crear otro.",
        )
    d = Disbursement(
        disb_no=disb_no,
        disb_sub=0,
        period_month=period,
        send_date=data.send_date,
        notes=data.notes,
    )
    db.add(d)
    db.flush()
    db.refresh(d)
    return d


def update_disbursement(db: Session, disb_id: int, data: DisbursementPatch) -> Disbursement:
    """Edita el encabezado. `disb_no` (numeración oficial) es corregible en
    cualquier estado, validando que no choque con otra tanda del mismo sub.
    Período, fecha de envío y notas solo se tocan en borrador (los estados
    posteriores quedan congelados; para cambios se emite un sub-desembolso)."""
    d = _require(db, disb_id)
    fields = data.model_dump(exclude_unset=True)

    if "disb_no" in fields and fields["disb_no"] is not None and fields["disb_no"] != d.disb_no:
        new_no = fields["disb_no"]
        clash = db.execute(
            select(Disbursement).where(
                Disbursement.disb_no == new_no,
                Disbursement.disb_sub == d.disb_sub,
                Disbursement.id != disb_id,
            )
        ).scalars().first()
        if clash is not None:
            raise Problem(
                status_code=409,
                title="Número en uso",
                detail=f"Ya existe un Disbursement #{new_no}.",
            )
        d.disb_no = new_no

    header = {k: fields[k] for k in ("period_month", "send_date", "notes") if k in fields}
    if header and d.status != "draft":
        raise Problem(
            status_code=409,
            title="Solo se edita un borrador",
            detail=f'El desembolso está en estado "{d.status}"; el encabezado quedó congelado.',
        )
    if "period_month" in header and header["period_month"] is not None:
        # period_is_month_start exige día 1; normalizamos como al crear.
        d.period_month = header["period_month"].replace(day=1)
    if "send_date" in header:
        d.send_date = header["send_date"]
    if "notes" in header:
        d.notes = header["notes"]

    db.flush()
    db.refresh(d)
    return d


def _require(db: Session, disb_id: int) -> Disbursement:
    d = repo.get_disbursement(db, disb_id)
    if d is None:
        raise Problem(status_code=404, title="Desembolso no encontrado")
    return d


def _require_draft(db: Session, disb_id: int) -> Disbursement:
    d = repo.get_disbursement(db, disb_id)
    if d is None:
        raise Problem(status_code=404, title="Desembolso no encontrado")
    return d


def add_line(db: Session, disb_id: int, data: LineIn) -> DisbursementLine:
    _require_draft(db, disb_id)
    line = DisbursementLine(
        disbursement_id=disb_id,
        line_no=repo.next_line_no(db, disb_id),
        **data.model_dump(),
    )
    db.add(line)
    db.flush()  # dispara disb_lines_locked (rechaza si no es borrador) + total
    return line


def update_line(db: Session, line_id: int, data: LineUpdate) -> DisbursementLine:
    line = repo.get_line(db, line_id)
    if line is None:
        raise Problem(status_code=404, title="Línea no encontrada")
    fields = data.model_dump(exclude_unset=True)
    # Name escrito a mano: resuelve (o crea) el proveedor; vacío lo deja sin uno.
    if "payee_name" in fields:
        fields["payee_id"] = resolve_payee_id(db, fields.pop("payee_name"))
    for field, value in fields.items():
        setattr(line, field, value)
    db.flush()
    return line


def delete_line(db: Session, line_id: int) -> None:
    line = repo.get_line(db, line_id)
    if line is None:
        raise Problem(status_code=404, title="Línea no encontrada")
    db.delete(line)
    db.flush()


def resolve_payee_id(db: Session, name: str | None) -> int | None:
    """Busca un payee por nombre (case-insensitive); si no existe y hay nombre, lo
    crea (solo el nombre — banco/IBAN los completa el owner). Devuelve el id."""
    if not name or not name.strip():
        return None
    nm = name.strip()
    pid = db.execute(
        text("SELECT id FROM payee WHERE lower(name) = lower(:n) LIMIT 1"), {"n": nm}
    ).scalar()
    if pid is not None:
        return int(pid)
    return int(
        db.execute(
            text("INSERT INTO payee (name, currency, is_active) VALUES (:n, 'USD', true) RETURNING id"),
            {"n": nm},
        ).scalar_one()
    )


def replace_lines_from_excel(db: Session, disb_id: int, rows: list[dict[str, Any]]) -> int:
    """Reemplaza TODAS las líneas del desembolso (borrador) con las del Excel.
    Devuelve cuántas líneas quedaron. El total se recalcula por trigger."""
    _require_draft(db, disb_id)
    db.execute(
        text("DELETE FROM disbursement_line WHERE disbursement_id = :d"), {"d": disb_id}
    )
    n = 0
    for i, r in enumerate(rows, start=1):
        if not (r.get("description") or "").strip():
            continue
        line = DisbursementLine(
            disbursement_id=disb_id,
            line_no=i,
            description=r["description"],
            invoice_no=r.get("invoice_no"),
            amount=r.get("amount") or Decimal(0),
            reason=r.get("reason"),
            transfer=r.get("transfer") or "SEND",
            payee_id=resolve_payee_id(db, r.get("payee_name")),
        )
        db.add(line)
        n += 1
    db.flush()  # dispara disb_lines_locked (rechaza si no es borrador) + recálculo total
    return n


def _fill_label(label: str, period: date) -> str:
    """Resuelve {MONTH} / {YEAR} con el período de la tanda: los recurrentes se
    guardan como plantilla ("Development Team - {MONTH} {YEAR}") y cada mes salen
    con su mes ("Development Team - AUGUST 2026")."""
    return (
        label.replace("{MONTH}", period.strftime("%B").upper())
        .replace("{YEAR}", str(period.year))
        .strip()
    )


def preload_recurring(db: Session, disb_id: int) -> int:
    """Crea una línea por cada recurrente activo del período. Devuelve cuántas."""
    d = _require_draft(db, disb_id)
    start, end = _month_bounds(d.period_month)
    items = repo.active_recurring_for_period(db, start, end)
    # Se leen de la base (no del relationship, que puede venir cacheado): apretar
    # el botón dos veces no debe duplicar nada.
    rows = db.execute(
        text("SELECT recurring_id, description FROM disbursement_line WHERE disbursement_id = :d"),
        {"d": disb_id},
    ).all()
    existing = {r[0] for r in rows if r[0] is not None}
    # También por descripción: las líneas viejas (importadas del Excel) no traen
    # recurring_id y no deben duplicarse al presionar el botón.
    seen_desc = {(r[1] or "").strip().lower() for r in rows}
    n = repo.next_line_no(db, disb_id)
    created = 0
    for it in items:
        if it.id in existing:
            continue  # ya precargado, no duplicar
        label = _fill_label(it.label, d.period_month)
        if label.strip().lower() in seen_desc:
            continue  # ya está esa línea en la tanda (cargada a mano o del Excel)
        seen_desc.add(label.strip().lower())
        payee = repo.get_payee(db, it.payee_id)
        line = DisbursementLine(
            disbursement_id=disb_id,
            line_no=n,
            description=label,
            amount=it.default_amount or 0,
            currency=it.currency,
            wbs_id=it.wbs_id,
            category_id=payee.default_category_id if payee else None,
            phase_id=payee.default_phase_id if payee else None,
            reason=it.reason,
            payee_id=it.payee_id,
            recurring_id=it.id,
            transfer="SEND",  # todo lo que se pide a corporativo se envía
        )
        db.add(line)
        n += 1
        created += 1
    db.flush()
    return created


def apply_credit(
    db: Session, disb_id: int, amount: Decimal, note: str | None, user: CurrentUser
) -> Disbursement:
    d = _require_draft(db, disb_id)
    ca = CreditApplication(
        disbursement_id=disb_id,
        applied_date=date.today(),
        amount=amount,
        note=note,
        applied_by=user.id,
    )
    db.add(ca)
    db.flush()  # sync_credit_applied ajusta el total
    # credit_not_overdrawn es un CONSTRAINT TRIGGER DEFERRED (valida al commit).
    # Lo forzamos ahora para devolver el error de forma síncrona, no después
    # de haber respondido 200.
    db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    db.refresh(d)
    return d


def create_adjustment(db: Session, data: AdjustmentIn, user: CurrentUser) -> CreditAdjustment:
    """Ajuste manual del saldo de crédito (diferencias de cambio, comisiones, etc.)."""
    adj = CreditAdjustment(
        entry_date=data.entry_date,
        amount=data.amount,
        description=data.description,
        created_by=user.id,
    )
    db.add(adj)
    db.flush()
    # credit_not_overdrawn (constraint trigger DEFERRED) también cubre los ajustes:
    # un ajuste negativo no puede dejar el saldo por debajo de lo ya aplicado.
    # Lo forzamos ahora para rechazar de forma síncrona, no al commit.
    db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    return adj


def update_adjustment(db: Session, adj_id: int, data: AdjustmentUpdate) -> CreditAdjustment:
    """Corrige un ajuste manual. Si el nuevo monto sobregira el crédito, el
    constraint trigger lo rechaza (forzado a IMMEDIATE)."""
    adj = db.get(CreditAdjustment, adj_id)
    if adj is None:
        raise Problem(status_code=404, title="Ajuste no encontrado")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(adj, field, value)
    db.flush()
    db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    return adj


def delete_adjustment(db: Session, adj_id: int) -> None:
    """Anula un ajuste manual. Si al quitarlo el saldo queda negativo (porque
    ya se aplicó crédito), el constraint trigger lo rechaza."""
    adj = db.get(CreditAdjustment, adj_id)
    if adj is None:
        raise Problem(status_code=404, title="Ajuste no encontrado")
    db.delete(adj)
    db.flush()
    db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


def _transition(db: Session, disb_id: int, to_status: str, user: CurrentUser) -> Disbursement:
    d = repo.get_disbursement(db, disb_id)
    if d is None:
        raise Problem(status_code=404, title="Desembolso no encontrado")
    now = datetime.now(UTC)
    if to_status == "submitted":
        if d.status != "draft":
            raise Problem(status_code=409, title="Solo se envía un borrador")
        if not d.lines:
            raise Problem(status_code=422, title="Sin líneas", detail="El desembolso está vacío.")
        d.status = "submitted"
        d.submitted_at = now
        d.submitted_by = user.id
    db.flush()
    db.refresh(d)
    return d


def submit(db: Session, disb_id: int, user: CurrentUser) -> Disbursement:
    return _transition(db, disb_id, "submitted", user)


def approve(db: Session, disb_id: int, user: CurrentUser) -> Disbursement:
    """Registra la aprobación del usuario. Sobre el umbral hacen falta DOS
    aprobadores distintos; recién ahí el desembolso pasa a 'approved'."""
    d = repo.get_disbursement(db, disb_id)
    if d is None:
        raise Problem(status_code=404, title="Desembolso no encontrado")
    if d.status != "submitted":
        raise Problem(status_code=409, title="Solo se aprueba lo enviado a corporativo")

    # ¿este usuario ya aprobó?
    already = db.execute(
        text(
            "SELECT 1 FROM disbursement_approval WHERE disbursement_id=:d AND approver_id=:u"
        ),
        {"d": disb_id, "u": user.id},
    ).first()
    if already:
        raise Problem(
            status_code=409,
            title="Ya aprobado por usted",
            detail="Hace falta la aprobación de otro usuario distinto.",
        )

    db.add(
        DisbursementApproval(
            disbursement_id=disb_id,
            approver_id=user.id,
            approved_at=datetime.now(UTC),
        )
    )
    db.flush()

    threshold = get_settings().disb_approval_threshold
    needed = 2 if d.total_amount > threshold else 1
    count = db.execute(
        text("SELECT count(*) FROM disbursement_approval WHERE disbursement_id=:d"),
        {"d": disb_id},
    ).scalar_one()

    if count >= needed:
        d.status = "approved"
        d.approved_at = datetime.now(UTC)
        d.approved_by = user.id
        db.flush()
    db.refresh(d)
    return d


def reopen(db: Session, disb_id: int, user: CurrentUser) -> Disbursement:
    """Devuelve la tanda a BORRADOR para corregirla (des-enviar / des-aprobar).

    Borra las aprobaciones y las marcas de envío/aprobación; con eso el trigger
    disb_lines_locked vuelve a permitir editar las líneas. Solo desde 'submitted'
    o 'approved': si ya se fondeó/transfirió, la corrección va por sub-desembolso.
    """
    d = repo.get_disbursement(db, disb_id)
    if d is None:
        raise Problem(status_code=404, title="Desembolso no encontrado")
    if d.status == "draft":
        return d
    if d.status not in ("submitted", "approved"):
        raise Problem(
            status_code=409,
            title="No se puede reabrir",
            detail=f'La tanda está en "{d.status}"; a esa altura la corrección se hace '
            "con un sub-desembolso, no reabriendo.",
        )
    db.execute(
        text("DELETE FROM disbursement_approval WHERE disbursement_id = :d"), {"d": disb_id}
    )
    d.status = "draft"
    d.submitted_at = None
    d.submitted_by = None
    d.approved_at = None
    d.approved_by = None
    db.flush()
    db.refresh(d)
    return d


def approvals(db: Session, disb_id: int) -> list[dict[str, object]]:
    rows = db.execute(
        text(
            """
            SELECT a.approver_id, u.full_name, a.approved_at
            FROM disbursement_approval a
            JOIN app_user u ON u.id = a.approver_id
            WHERE a.disbursement_id = :d
            ORDER BY a.approved_at
            """
        ),
        {"d": disb_id},
    ).mappings().all()
    return [dict(r) for r in rows]
