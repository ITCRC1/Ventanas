"""Schemas del tab US Wire Transfers (aportes de los dueños)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel


class UsWireIn(BaseModel):
    block: str = "ventanas_ii"
    trans_label: str | None = None
    wire_date: date | None = None
    sender: str | None = None
    from_party: str | None = None
    to_party: str | None = None
    account_number: str | None = None
    amount_received: Decimal = Decimal(0)  # lo que llega a Ventanas LAFISE
    amount_sent: Decimal | None = None  # monto completo enviado por los dueños
    notas: str | None = None


class UsWireUpdate(BaseModel):
    block: str | None = None
    trans_label: str | None = None
    wire_date: date | None = None
    sender: str | None = None
    from_party: str | None = None
    to_party: str | None = None
    account_number: str | None = None
    amount_received: Decimal | None = None
    amount_sent: Decimal | None = None
    notas: str | None = None
