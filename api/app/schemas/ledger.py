"""Schemas del ledger."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class LedgerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    wbs_id: int | None
    disbursement_id: int | None
    invoice_id: int | None
    payee_id: int | None
    bank_tx_id: int | None
    entry_date: date | None
    invoice_no: str | None
    description: str | None
    currency: str
    amount: Decimal
    fx_rate: Decimal
    amount_paid: Decimal
    amount_usd: Decimal | None
    amount_paid_usd: Decimal | None
    amount_due: Decimal | None
    funding_source: str | None
    status: str
    released_reason: str | None


class LedgerIn(BaseModel):
    wbs_id: int | None = None
    disbursement_id: int | None = None
    invoice_id: int | None = None
    payee_id: int | None = None
    entry_date: date | None = None
    invoice_no: str | None = None
    description: str | None = None
    currency: str = "USD"
    amount: Decimal
    fx_rate: Decimal = Decimal(1)
    amount_paid: Decimal = Decimal(0)
    funding_source: str | None = None
    status: str = "pending"
    released_reason: str | None = None


class LedgerUpdate(BaseModel):
    wbs_id: int | None = None
    entry_date: date | None = None
    description: str | None = None
    amount: Decimal | None = None
    fx_rate: Decimal | None = None
    amount_paid: Decimal | None = None
    status: str | None = None
    released_reason: str | None = None


class LedgerLinePatch(BaseModel):
    """Edición de una línea reflejada del Short Payment desde el LEDGER."""

    amount_paid: Decimal | None = None
    wbs_id: int | None = None


class LedgerSheetPatch(BaseModel):
    """Edición de una fila del LEDGER: montos/WBS/pago + campos de texto libres
    (fecha, proveedor, descripción, etc.). Solo se aplican los campos enviados."""

    amount_paid: Decimal | None = None
    wbs_id: int | None = None
    payment_id: int | None = None
    # texto editable (proveedor, fecha, etc.)
    entry_date: str | None = None
    invoice_no: str | None = None
    payee: str | None = None
    description: str | None = None
    paid_total: str | None = None
    date_paid: str | None = None
    payment_info: str | None = None
    bank_paid_from: str | None = None
    request: str | None = None
    notes: str | None = None


class PaymentIn(BaseModel):
    """Pago que se reparte en cuotas entre varios Disbursements."""

    label: str
    total_amount: Decimal
    notes: str | None = None


class ImportDisbursement(BaseModel):
    """Traer todas las líneas de un Short Payment (por su # de Disbursement) al LEDGER."""

    disb_no: int


class LedgerFilter(BaseModel):
    status: str | None = None
    wbs_id: int | None = None
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)
