"""Lógica de facturas: captura con líneas y reparto entre WBS."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.problems import Problem
from app.models.invoice import Invoice, InvoiceLine
from app.schemas.invoice import InvoiceIn, InvoiceLineIn, InvoiceLineUpdate, InvoiceUpdate


def list_invoices(db: Session) -> list[Invoice]:
    return list(db.execute(select(Invoice).order_by(Invoice.issue_date.desc())).scalars())


def get_invoice(db: Session, invoice_id: int) -> Invoice | None:
    return db.execute(
        select(Invoice).options(selectinload(Invoice.lines)).where(Invoice.id == invoice_id)
    ).scalar_one_or_none()


def _require(db: Session, invoice_id: int) -> Invoice:
    inv = get_invoice(db, invoice_id)
    if inv is None:
        raise Problem(status_code=404, title="Factura no encontrada")
    return inv


def _require_active(db: Session, invoice_id: int) -> Invoice:
    """Como _require, pero rechaza editar una factura anulada (status='void')."""
    inv = _require(db, invoice_id)
    if inv.status == "void":
        raise Problem(
            status_code=409,
            title="Factura anulada",
            detail="La factura está anulada; no se puede editar.",
        )
    return inv


def _recompute(inv: Invoice) -> None:
    """subtotal = Σ líneas, total = subtotal + tax. Derivados: solo el motor los toca."""
    inv.subtotal = sum((ln.amount for ln in inv.lines), Decimal(0))
    inv.total = inv.subtotal + (inv.tax or Decimal(0))


def create_invoice(db: Session, data: InvoiceIn) -> Invoice:
    if not data.lines:
        raise Problem(status_code=422, title="Sin líneas", detail="La factura no tiene líneas.")
    subtotal = sum((ln.amount for ln in data.lines), Decimal(0))
    total = subtotal + (data.tax or Decimal(0))
    inv = Invoice(
        invoice_no=data.invoice_no,
        payee_id=data.payee_id,
        issue_date=data.issue_date,
        due_date=data.due_date,
        currency=data.currency,
        subtotal=subtotal,
        tax=data.tax,
        total=total,
        notes=data.notes,
    )
    for i, ln in enumerate(data.lines, 1):
        inv.lines.append(
            InvoiceLine(
                line_no=i,
                description=ln.description,
                quantity=ln.quantity,
                unit_price=ln.unit_price,
                amount=ln.amount,
                wbs_id=ln.wbs_id,
            )
        )
    db.add(inv)
    db.flush()
    db.refresh(inv)
    return inv


def update_invoice(db: Session, invoice_id: int, data: InvoiceUpdate) -> Invoice:
    """Edita la cabecera. Si cambia `tax`, recomputa el total (subtotal no cambia)."""
    inv = _require_active(db, invoice_id)
    fields = data.model_dump(exclude_unset=True)
    for field, value in fields.items():
        setattr(inv, field, value)
    if "tax" in fields:
        _recompute(inv)
    db.flush()  # UNIQUE(payee_id, invoice_no) → IntegrityError → 409 (handler global)
    db.refresh(inv)
    return inv


def void_invoice(db: Session, invoice_id: int) -> None:
    """Anula la factura marcándola status='void'. NO la borra: queda en el libro
    (auditable), read-only. Idempotente si ya estaba anulada."""
    inv = _require(db, invoice_id)
    inv.status = "void"
    db.flush()


def add_line(db: Session, invoice_id: int, data: InvoiceLineIn) -> Invoice:
    inv = _require_active(db, invoice_id)
    next_no = max((ln.line_no for ln in inv.lines), default=0) + 1
    inv.lines.append(
        InvoiceLine(
            line_no=next_no,
            description=data.description,
            quantity=data.quantity,
            unit_price=data.unit_price,
            amount=data.amount,
            wbs_id=data.wbs_id,
        )
    )
    _recompute(inv)
    db.flush()
    db.refresh(inv)
    return inv


def update_line(
    db: Session, invoice_id: int, line_id: int, data: InvoiceLineUpdate
) -> Invoice:
    inv = _require_active(db, invoice_id)
    line = next((ln for ln in inv.lines if ln.id == line_id), None)
    if line is None:
        raise Problem(status_code=404, title="Línea no encontrada")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(line, field, value)
    _recompute(inv)
    db.flush()
    db.refresh(inv)
    return inv


def delete_line(db: Session, invoice_id: int, line_id: int) -> Invoice:
    inv = _require_active(db, invoice_id)
    line = next((ln for ln in inv.lines if ln.id == line_id), None)
    if line is None:
        raise Problem(status_code=404, title="Línea no encontrada")
    if len(inv.lines) <= 1:
        raise Problem(
            status_code=422,
            title="Última línea",
            detail="La factura debe tener al menos una línea; anulá la factura si querés darla de baja.",
        )
    inv.lines.remove(line)
    _recompute(inv)
    db.flush()
    db.refresh(inv)
    return inv
