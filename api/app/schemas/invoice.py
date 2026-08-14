"""Schemas de facturas."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class InvoiceLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    line_no: int
    description: str
    quantity: Decimal | None
    unit_price: Decimal | None
    amount: Decimal
    wbs_id: int | None


class InvoiceLineIn(BaseModel):
    description: str = Field(min_length=1)
    amount: Decimal
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    wbs_id: int | None = None


class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    invoice_no: str
    payee_id: int
    issue_date: date
    due_date: date | None
    currency: str
    subtotal: Decimal | None
    tax: Decimal | None
    total: Decimal
    notes: str | None
    status: str


class InvoiceDetail(InvoiceOut):
    lines: list[InvoiceLineOut]


class InvoiceIn(BaseModel):
    invoice_no: str = Field(min_length=1)
    payee_id: int
    issue_date: date
    due_date: date | None = None
    currency: str = "USD"
    tax: Decimal | None = None
    notes: str | None = None
    lines: list[InvoiceLineIn]


class InvoiceUpdate(BaseModel):
    """Edición de la cabecera. subtotal/total son DERIVADOS → no se editan acá.

    `tax` sí es entrada: al cambiarlo la BD-de-app recomputa total = subtotal + tax.
    """

    invoice_no: str | None = Field(default=None, min_length=1)
    payee_id: int | None = None
    issue_date: date | None = None
    due_date: date | None = None
    currency: str | None = None
    tax: Decimal | None = None
    notes: str | None = None


class InvoiceLineUpdate(BaseModel):
    """Edición de una línea. `amount` es entrada; el subtotal/total se recomputan."""

    description: str | None = Field(default=None, min_length=1)
    amount: Decimal | None = None
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    wbs_id: int | None = None
