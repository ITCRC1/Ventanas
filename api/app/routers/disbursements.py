"""Short Payment — desembolsos, payees, recurrentes, crédito y PDFs."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Response, UploadFile
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.permissions import require_permission, user_permissions
from app.core.problems import Problem
from app.deps import CurrentUser, get_current_user, get_db
from app.export.disb_excel import lines_to_xlsx, parse_lines_xlsx
from app.export.pdf import breakdown_html, instruction_html, render_pdf
from app.models.disbursement import (
    CreditAdjustment,
    Disbursement,
    DisbursementLine,
    InstructionTemplate,
    Payee,
    RecurringItem,
)
from app.repositories import disbursement as repo
from app.schemas.disbursement import (
    AdjustmentIn,
    AdjustmentOut,
    AdjustmentUpdate,
    ApprovalInfo,
    BreakdownRow,
    CreditBalance,
    CreditIn,
    CreditMovement,
    DisbursementDetail,
    DisbursementIn,
    DisbursementOut,
    DisbursementPatch,
    LineIn,
    LineOut,
    LineUpdate,
    PayeeIn,
    PayeeOut,
    RecurringIn,
    RecurringOut,
    ShortPaymentBatch,
    ShortPaymentLine,
)
from app.services import disbursement as svc

router = APIRouter(tags=["desembolsos"], dependencies=[Depends(get_current_user)])

_can_create = Depends(require_permission("disb.create"))
_can_submit = Depends(require_permission("disb.submit"))
_can_approve = Depends(require_permission("disb.approve"))
_PDF = "application/pdf"


def _hide_iban(db: Session, user: CurrentUser, payee: Payee) -> PayeeOut:
    out = PayeeOut.model_validate(payee)
    if "bank.view" not in user_permissions(db, user.role_id):
        out.iban = None
    return out


# --- Payees -----------------------------------------------------------------
pay = APIRouter(prefix="/payees")


@pay.get("", response_model=list[PayeeOut])
def list_payees(
    only_active: bool = False,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[PayeeOut]:
    return [_hide_iban(db, user, p) for p in repo.list_payees(db, only_active=only_active)]


@pay.post("", response_model=PayeeOut, status_code=201, dependencies=[_can_create])
def create_payee(
    data: PayeeIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> PayeeOut:
    return _hide_iban(db, user, svc.create_payee(db, data))


# --- Recurrentes ------------------------------------------------------------
rec = APIRouter(prefix="/recurring")


@rec.get("", response_model=list[RecurringOut])
def list_recurring(only_active: bool = True, db: Session = Depends(get_db)) -> list[RecurringItem]:
    return repo.list_recurring(db, only_active=only_active)


@rec.post("", response_model=RecurringOut, status_code=201, dependencies=[_can_create])
def create_recurring(data: RecurringIn, db: Session = Depends(get_db)) -> RecurringItem:
    return svc.create_recurring(db, data)


# --- Crédito ----------------------------------------------------------------
cred = APIRouter(prefix="/credit")


@cred.get("/balance", response_model=CreditBalance)
def credit_balance(db: Session = Depends(get_db)) -> dict[str, object]:
    return repo.credit_balance(db)


@cred.get("/ledger", response_model=list[CreditMovement])
def credit_ledger(db: Session = Depends(get_db)) -> list[dict[str, object]]:
    return repo.credit_ledger(db)


@cred.get("/adjustment", response_model=list[AdjustmentOut])
def list_adjustments(db: Session = Depends(get_db)) -> list[CreditAdjustment]:
    return repo.list_adjustments(db)


@cred.post("/adjustment", status_code=201, dependencies=[_can_create])
def create_adjustment(
    data: AdjustmentIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> dict[str, int]:
    adj: CreditAdjustment = svc.create_adjustment(db, data, user)
    return {"id": adj.id}


@cred.patch("/adjustment/{adj_id}", response_model=AdjustmentOut, dependencies=[_can_create])
def update_adjustment(
    adj_id: int, data: AdjustmentUpdate, db: Session = Depends(get_db)
) -> CreditAdjustment:
    return svc.update_adjustment(db, adj_id, data)


@cred.delete("/adjustment/{adj_id}", status_code=204, dependencies=[_can_create])
def delete_adjustment(adj_id: int, db: Session = Depends(get_db)) -> Response:
    svc.delete_adjustment(db, adj_id)
    return Response(status_code=204)


# --- Desembolsos ------------------------------------------------------------
disb = APIRouter(prefix="/disbursements")


@disb.get("", response_model=list[DisbursementOut])
def list_disbursements(db: Session = Depends(get_db)) -> list[Disbursement]:
    return repo.list_disbursements(db)


@disb.get("/short-payments", response_model=list[ShortPaymentBatch])
def short_payments(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[ShortPaymentBatch]:
    """Lista de pagos por tanda, formato del Short Payment List del Excel."""
    show_bank = "bank.view" in user_permissions(db, user.role_id)
    batches: dict[int, ShortPaymentBatch] = {}
    for r in repo.short_payments(db):
        b = batches.get(r["id"])
        if b is None:
            b = ShortPaymentBatch(
                id=r["id"],
                disb_no=r["disb_no"],
                disb_sub=r["disb_sub"],
                period_month=r["period_month"],
                send_date=r["send_date"],
                status=r["status"],
                total_amount=r["total_amount"],
                lines=[],
            )
            batches[r["id"]] = b
        if r["line_no"] is not None:
            b.lines.append(
                ShortPaymentLine(
                    id=r["line_id"],
                    line_no=r["line_no"],
                    description=r["description"],
                    invoice_no=r["invoice_no"],
                    amount=r["amount"],
                    wbs_code=r["wbs_code"],
                    wbs_title=r["wbs_title"],
                    category=r["category"],
                    type=r["type"],
                    category_id=r["category_id"],
                    phase_id=r["phase_id"],
                    reason=r["reason"],
                    payee_name=r["payee_name"],
                    transfer=r["transfer"],
                    bank_name=r["bank_name"] if show_bank else None,
                    beneficiary=r["legal_id"] if show_bank else None,
                    account=r["iban"] if show_bank else None,
                )
            )
    return list(batches.values())


@disb.get("/cycle-status")
def cycle_status(from_no: int = 26, db: Session = Depends(get_db)) -> list[dict[str, object]]:
    """Estado del ciclo del mes por tanda: líneas → envío → Ledger → Cost Codes →
    Job Cost → facturas. Arranca en el #26 (lo anterior está validado y no se toca).
    """
    rows = (
        db.execute(
            text(
                """
                SELECT d.disb_no, d.disb_sub, d.period_month, d.send_date, d.status,
                       d.total_amount,
                       (SELECT count(*) FROM disbursement_line l
                         WHERE l.disbursement_id = d.id) AS lines,
                       (SELECT count(*) FROM ledger_sheet_row s
                         WHERE s.src_disb_no = d.disb_no AND s.source = 'import') AS ledger_rows,
                       (SELECT count(*) FROM ledger_sheet_row s
                         WHERE s.src_disb_no = d.disb_no AND s.source = 'import'
                           AND (s.cost_code IS NULL OR s.cost_code = '')) AS ledger_no_code,
                       (SELECT count(*) FROM ledger_sheet_row s
                         JOIN invoice_receipt_link k ON k.sheet_row_id = s.id
                         WHERE s.src_disb_no = d.disb_no) AS invoiced_rows,
                       (SELECT count(*) FROM invoice_receipt r
                         WHERE r.status <> 'ignored'
                           AND date_trunc('month', r.invoice_date)
                               = date_trunc('month', d.period_month)
                           AND NOT EXISTS (SELECT 1 FROM invoice_receipt_link k2
                                            WHERE k2.receipt_id = r.id)) AS invoices_pending
                FROM disbursement d
                WHERE d.disb_no >= :from_no
                ORDER BY d.disb_no DESC, d.disb_sub
                """
            ),
            {"from_no": from_no},
        )
        .mappings()
        .all()
    )
    out: list[dict[str, object]] = []
    for r in rows:
        d = dict(r)
        # Job Cost: de los proyectos que trae el Ledger de esa tanda, cuántos ya
        # tienen monto en el cronograma de ese mes.
        codes = db.execute(
            text(
                "SELECT DISTINCT cost_code FROM ledger_sheet_row "
                "WHERE src_disb_no = :n AND source = 'import' AND cost_code IS NOT NULL"
            ),
            {"n": r["disb_no"]},
        ).scalars().all()
        placed = 0
        if codes:
            placed = db.execute(
                text(
                    """
                    SELECT count(DISTINCT w.wbs_code)
                    FROM schedule_cell c
                    JOIN wbs_item w ON w.id = c.wbs_id
                    WHERE w.wbs_code = ANY(:codes)
                      AND date_trunc('month', c.week_start) = date_trunc('month', :pm)
                      AND COALESCE(c.planned_amount, 0) <> 0
                    """
                ),
                {"codes": list(codes), "pm": r["period_month"]},
            ).scalar_one()
        d["jobcost_codes"] = len(codes)
        d["jobcost_placed"] = int(placed)
        out.append(d)
    return out


@disb.post("", response_model=DisbursementDetail, status_code=201, dependencies=[_can_create])
def create_disbursement(data: DisbursementIn, db: Session = Depends(get_db)) -> Disbursement:
    return svc.create_disbursement(db, data)


def _require(db: Session, disb_id: int) -> Disbursement:
    d = repo.get_disbursement(db, disb_id)
    if d is None:
        raise Problem(status_code=404, title="Desembolso no encontrado")
    return d


@disb.get("/{disb_id}", response_model=DisbursementDetail)
def get_disbursement(disb_id: int, db: Session = Depends(get_db)) -> Disbursement:
    return _require(db, disb_id)


@disb.patch("/{disb_id}", response_model=DisbursementOut, dependencies=[_can_create])
def update_disbursement(
    disb_id: int, data: DisbursementPatch, db: Session = Depends(get_db)
) -> Disbursement:
    """Edita el encabezado de la tanda: número oficial (cualquier estado, sin
    chocar con otra), y período/fecha de envío/notas (solo en borrador)."""
    return svc.update_disbursement(db, disb_id, data)


@disb.post("/{disb_id}/lines", response_model=LineOut, status_code=201, dependencies=[_can_create])
def add_line(disb_id: int, data: LineIn, db: Session = Depends(get_db)) -> DisbursementLine:
    return svc.add_line(db, disb_id, data)


@disb.patch("/{disb_id}/lines/{line_id}", response_model=LineOut, dependencies=[_can_create])
def update_line(
    disb_id: int, line_id: int, data: LineUpdate, db: Session = Depends(get_db)
) -> DisbursementLine:
    return svc.update_line(db, line_id, data)


@disb.delete("/{disb_id}/lines/{line_id}", status_code=204, dependencies=[_can_create])
def delete_line(disb_id: int, line_id: int, db: Session = Depends(get_db)) -> Response:
    svc.delete_line(db, line_id)
    return Response(status_code=204)


@disb.post("/{disb_id}/preload-recurring", dependencies=[_can_create])
def preload_recurring(disb_id: int, db: Session = Depends(get_db)) -> dict[str, int]:
    return {"created": svc.preload_recurring(db, disb_id)}


_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@disb.get("/{disb_id}/lines.xlsx", dependencies=[_can_create])
def lines_xlsx(disb_id: int, db: Session = Depends(get_db)) -> Response:
    """Baja las líneas del desembolso a Excel para editarlas cómodamente."""
    d = _require(db, disb_id)
    rows = (
        db.execute(
            text(
                "SELECT dl.description, dl.invoice_no, dl.reason, dl.transfer, dl.amount, "
                "       p.name AS payee_name "
                "FROM disbursement_line dl LEFT JOIN payee p ON p.id = dl.payee_id "
                "WHERE dl.disbursement_id = :id ORDER BY dl.line_no"
            ),
            {"id": d.id},
        )
        .mappings()
        .all()
    )
    data = lines_to_xlsx(d, [dict(r) for r in rows])
    name = f"ShortPayment_{d.disb_no}.{d.disb_sub}.xlsx"
    return Response(
        data, media_type=_XLSX, headers={"Content-Disposition": f'attachment; filename="{name}"'}
    )


@disb.post("/{disb_id}/lines/import", dependencies=[_can_create])
async def import_lines(
    disb_id: int, file: Annotated[UploadFile, File()], db: Session = Depends(get_db)
) -> dict[str, object]:
    """Sube un Excel (bajado con lines.xlsx, editado) y REEMPLAZA las líneas del
    desembolso. Debe estar en borrador."""
    raw = await file.read()
    try:
        rows = parse_lines_xlsx(raw)
    except ValueError as exc:
        raise Problem(status_code=400, title="Excel inválido", detail=str(exc)) from exc
    n = svc.replace_lines_from_excel(db, disb_id, rows)
    return {"ok": True, "imported": n}


@disb.post("/{disb_id}/credit", response_model=DisbursementDetail, dependencies=[_can_create])
def apply_credit(
    disb_id: int,
    data: CreditIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> Disbursement:
    svc.apply_credit(db, disb_id, data.amount, data.note, user)
    return _require(db, disb_id)


@disb.post("/{disb_id}/submit", response_model=DisbursementOut, dependencies=[_can_submit])
def submit(
    disb_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)
) -> Disbursement:
    return svc.submit(db, disb_id, user)


@disb.post("/{disb_id}/approve", response_model=DisbursementOut, dependencies=[_can_approve])
def approve(
    disb_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)
) -> Disbursement:
    return svc.approve(db, disb_id, user)


@disb.post("/{disb_id}/reopen", response_model=DisbursementOut)
def reopen(
    disb_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)
) -> Disbursement:
    """Vuelve la tanda a borrador para corregirla. Des-aprobar exige permiso de
    aprobación; des-enviar, el de envío."""
    d = _require(db, disb_id)
    needed = "disb.approve" if d.status == "approved" else "disb.submit"
    if needed not in user_permissions(db, user.role_id):
        raise Problem(
            status_code=403,
            title="Sin permiso para reabrir",
            detail=f"Hace falta el permiso {needed}.",
        )
    return svc.reopen(db, disb_id, user)


@disb.get("/{disb_id}/approvals", response_model=ApprovalInfo)
def approvals(disb_id: int, db: Session = Depends(get_db)) -> ApprovalInfo:
    d = _require(db, disb_id)
    rows = svc.approvals(db, disb_id)
    threshold = get_settings().disb_approval_threshold
    needed = 2 if d.total_amount > threshold else 1
    return ApprovalInfo(
        approvals=rows,  # type: ignore[arg-type]
        threshold=threshold,
        needed=needed,
        approved_count=len(rows),
        fully_approved=d.status in ("approved", "funded", "transferred", "settled"),
    )


@disb.get("/{disb_id}/breakdown", response_model=list[BreakdownRow])
def breakdown(disb_id: int, db: Session = Depends(get_db)) -> list[dict[str, object]]:
    d = _require(db, disb_id)
    return repo.breakdown(db, d.disb_no, d.disb_sub)


def _breakdown_ctx(
    db: Session, user: CurrentUser, disb_id: int
) -> tuple[Disbursement, list[dict[str, object]], bool]:
    d = _require(db, disb_id)
    rows = repo.breakdown(db, d.disb_no, d.disb_sub)
    show_bank = "bank.view" in user_permissions(db, user.role_id)
    return d, rows, show_bank


@disb.get("/{disb_id}/breakdown.pdf")
def breakdown_pdf(
    disb_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)
) -> Response:
    d, rows, show_bank = _breakdown_ctx(db, user, disb_id)
    pdf = render_pdf(breakdown_html(d, rows, show_bank=show_bank))
    name = f"Breakdown_{d.disb_no}.{d.disb_sub}.pdf"
    return Response(pdf, media_type=_PDF, headers={"Content-Disposition": f'inline; filename="{name}"'})


@disb.get("/{disb_id}/instruction.pdf")
def instruction_pdf(
    disb_id: int, db: Session = Depends(get_db), user: CurrentUser = Depends(get_current_user)
) -> Response:
    d, rows, show_bank = _breakdown_ctx(db, user, disb_id)
    tpl = db.execute(
        select(InstructionTemplate)
        .where(InstructionTemplate.is_active.is_(True))
        .order_by(InstructionTemplate.id.desc())
    ).scalars().first()
    if tpl is None:
        raise Problem(
            status_code=404,
            title="Sin plantilla",
            detail="No hay plantilla de instrucción activa.",
        )
    pdf = render_pdf(instruction_html(d, tpl, rows, show_bank=show_bank))
    name = f"Instruccion_{d.disb_no}.{d.disb_sub}.pdf"
    return Response(pdf, media_type=_PDF, headers={"Content-Disposition": f'inline; filename="{name}"'})


for _sub in (pay, rec, cred, disb):
    router.include_router(_sub)
