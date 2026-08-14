"""Facturas — captura con líneas y reparto entre WBS."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.core.problems import Problem
from app.deps import get_current_user, get_db
from app.models.invoice import Invoice
from app.schemas.invoice import (
    InvoiceDetail,
    InvoiceIn,
    InvoiceLineIn,
    InvoiceLineUpdate,
    InvoiceOut,
    InvoiceUpdate,
)
from app.services import invoice as svc

router = APIRouter(prefix="/invoices", tags=["facturas"], dependencies=[Depends(get_current_user)])

_can_edit = Depends(require_permission("ledger.edit"))


@router.get("", response_model=list[InvoiceOut])
def list_invoices(db: Session = Depends(get_db)) -> list[Invoice]:
    return svc.list_invoices(db)


@router.get("/{invoice_id}", response_model=InvoiceDetail)
def get_invoice(invoice_id: int, db: Session = Depends(get_db)) -> Invoice:
    inv = svc.get_invoice(db, invoice_id)
    if inv is None:
        raise Problem(status_code=404, title="Factura no encontrada")
    return inv


@router.post("", response_model=InvoiceDetail, status_code=201, dependencies=[_can_edit])
def create_invoice(data: InvoiceIn, db: Session = Depends(get_db)) -> Invoice:
    return svc.create_invoice(db, data)


@router.patch("/{invoice_id}", response_model=InvoiceDetail, dependencies=[_can_edit])
def update_invoice(invoice_id: int, data: InvoiceUpdate, db: Session = Depends(get_db)) -> Invoice:
    return svc.update_invoice(db, invoice_id, data)


@router.delete("/{invoice_id}", status_code=204, dependencies=[_can_edit])
def void_invoice(invoice_id: int, db: Session = Depends(get_db)) -> None:
    """Anula la factura (status='void'): queda en el libro, read-only. No la borra."""
    svc.void_invoice(db, invoice_id)


@router.post(
    "/{invoice_id}/lines", response_model=InvoiceDetail, status_code=201, dependencies=[_can_edit]
)
def add_line(invoice_id: int, data: InvoiceLineIn, db: Session = Depends(get_db)) -> Invoice:
    return svc.add_line(db, invoice_id, data)


@router.patch("/{invoice_id}/lines/{line_id}", response_model=InvoiceDetail, dependencies=[_can_edit])
def update_line(
    invoice_id: int, line_id: int, data: InvoiceLineUpdate, db: Session = Depends(get_db)
) -> Invoice:
    return svc.update_line(db, invoice_id, line_id, data)


@router.delete(
    "/{invoice_id}/lines/{line_id}", response_model=InvoiceDetail, dependencies=[_can_edit]
)
def delete_line(invoice_id: int, line_id: int, db: Session = Depends(get_db)) -> Invoice:
    return svc.delete_line(db, invoice_id, line_id)
