"""Schemas de desembolsos, payees, recurrentes y crédito."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ApprovalRow(BaseModel):
    approver_id: int
    full_name: str
    approved_at: datetime


class ApprovalInfo(BaseModel):
    approvals: list[ApprovalRow]
    threshold: Decimal
    needed: int
    approved_count: int
    fully_approved: bool

# --- Payees -----------------------------------------------------------------


class PayeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    legal_id: str | None
    bank_name: str | None
    iban: str | None  # se oculta si el usuario no tiene bank.view
    currency: str
    is_international: bool
    default_category_id: int | None
    default_phase_id: int | None
    is_active: bool


class PayeeIn(BaseModel):
    name: str = Field(min_length=1)
    legal_id: str | None = None
    bank_name: str | None = None
    iban: str | None = None
    currency: str = "USD"
    is_international: bool = False
    default_category_id: int | None = None
    default_phase_id: int | None = None


class PayeeUpdate(BaseModel):
    name: str | None = None
    legal_id: str | None = None
    bank_name: str | None = None
    iban: str | None = None
    currency: str | None = None
    is_international: bool | None = None
    default_category_id: int | None = None
    default_phase_id: int | None = None
    is_active: bool | None = None


# --- Recurrentes ------------------------------------------------------------


class RecurringOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    payee_id: int
    wbs_id: int | None
    reason: str | None
    default_amount: Decimal | None
    currency: str
    active_from: date
    active_to: date | None
    is_active: bool


class RecurringIn(BaseModel):
    label: str = Field(min_length=1)
    payee_id: int
    wbs_id: int | None = None
    reason: str | None = None
    default_amount: Decimal | None = None
    currency: str = "USD"
    active_from: date
    active_to: date | None = None


# --- Líneas de desembolso ---------------------------------------------------


class LineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    line_no: int
    description: str
    invoice_no: str | None
    vendor: str | None  # proveedor de la factura (no es el beneficiario del pago)
    amount: Decimal
    currency: str
    wbs_id: int | None
    category_id: int | None
    phase_id: int | None
    reason: str | None
    payee_id: int | None
    recurring_id: int | None
    transfer: str | None


class LineIn(BaseModel):
    description: str = Field(min_length=1)
    invoice_no: str | None = None
    vendor: str | None = None
    amount: Decimal
    currency: str = "USD"
    wbs_id: int | None = None
    category_id: int | None = None
    phase_id: int | None = None
    reason: str | None = None
    payee_id: int | None = None
    transfer: str | None = None


class LineUpdate(BaseModel):
    description: str | None = None
    invoice_no: str | None = None
    vendor: str | None = None
    amount: Decimal | None = None
    wbs_id: int | None = None
    category_id: int | None = None
    phase_id: int | None = None
    reason: str | None = None
    payee_id: int | None = None
    # Nombre escrito a mano en la columna Name: se resuelve al payee (lo crea si
    # no existe); "" o null explícito deja la línea sin proveedor.
    payee_name: str | None = None
    transfer: str | None = None


# --- Desembolsos ------------------------------------------------------------


class DisbursementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    disb_no: int
    disb_sub: int
    parent_id: int | None
    period_month: date
    send_date: date | None
    status: str
    credit_applied: Decimal
    total_amount: Decimal
    submitted_at: datetime | None
    approved_at: datetime | None
    notes: str | None


class DisbursementDetail(DisbursementOut):
    lines: list[LineOut]


class DisbursementIn(BaseModel):
    period_month: date  # cualquier día del mes; se normaliza al día 1
    disb_no: int | None = None  # si falta, se asigna el siguiente
    send_date: date | None = None
    notes: str | None = None


class DisbursementPatch(BaseModel):
    """Edición del encabezado de una tanda. `disb_no` corrige la numeración
    oficial (cualquier estado); período/fecha/notas solo en borrador.
    Todo opcional: se aplica lo enviado (exclude_unset)."""

    disb_no: int | None = None
    period_month: date | None = None
    send_date: date | None = None
    notes: str | None = None


# --- Crédito ----------------------------------------------------------------


class CreditIn(BaseModel):
    amount: Decimal = Field(gt=0)
    note: str | None = None


class CreditBalance(BaseModel):
    acumulado: Decimal
    aplicado: Decimal
    disponible: Decimal


class CreditMovement(BaseModel):
    move_date: date | None
    kind: str
    description: str | None
    amount: Decimal
    balance: Decimal


class AdjustmentIn(BaseModel):
    entry_date: date
    amount: Decimal  # + suma al saldo, − lo reduce
    description: str = Field(min_length=1)


class AdjustmentUpdate(BaseModel):
    """Edición de un ajuste manual existente. Todo opcional (exclude_unset)."""

    entry_date: date | None = None
    amount: Decimal | None = None
    description: str | None = Field(default=None, min_length=1)


class AdjustmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    entry_date: date
    amount: Decimal
    description: str


# --- Breakdown (v_breakdown_pdf) --------------------------------------------


class BreakdownRow(BaseModel):
    line_no: int
    description: str
    amount: Decimal
    category: str | None
    type: str | None
    reason: str | None
    payee_name: str | None
    bank_name: str | None
    beneficiary: str | None
    account: str | None


# --- Short Term Payments (lista de pagos por tanda, formato del Excel) --------


class ShortPaymentLine(BaseModel):
    id: int | None = None
    line_no: int
    description: str
    invoice_no: str | None = None
    amount: Decimal
    wbs_code: str | None = None  # Project Number (WBS)
    wbs_title: str | None = None
    category: str | None = None  # Category (propia o heredada del WBS)
    type: str | None = None  # Type/Fase (propia o heredada del WBS)
    category_id: int | None = None  # propios de la línea (para editarlos)
    phase_id: int | None = None
    reason: str | None  # Contract Amount / nota
    payee_name: str | None  # Name
    transfer: str | None  # SEND / HOLD / LAFISE
    bank_name: str | None
    beneficiary: str | None  # cédula/ID
    account: str | None  # IBAN (oculto sin bank.view)


class ShortPaymentBatch(BaseModel):
    id: int
    disb_no: int
    disb_sub: int
    period_month: date
    send_date: date | None
    status: str
    total_amount: Decimal
    lines: list[ShortPaymentLine]
