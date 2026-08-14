"""Schemas de bancos, wires y comisiones."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class BankAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    role: str
    currency: str
    is_active: bool


class WireOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    disbursement_id: int | None
    wire_date: date
    value_date: date | None
    sender: str
    to_account_id: int
    amount_sent: Decimal
    amount_received: Decimal | None
    reference: str | None
    note: str | None


class WireIn(BaseModel):
    wire_date: date
    to_account_id: int
    amount_sent: Decimal = Field(gt=0)
    disbursement_id: int | None = None
    value_date: date | None = None
    amount_received: Decimal | None = None
    reference: str | None = None
    note: str | None = None


class WireUpdate(BaseModel):
    wire_date: date | None = None
    value_date: date | None = None
    amount_sent: Decimal | None = Field(default=None, gt=0)
    amount_received: Decimal | None = None
    disbursement_id: int | None = None
    reference: str | None = None
    note: str | None = None


class WireFeeIn(BaseModel):
    fee_type: str  # sending | intermediary | beneficiary | fx | other | unidentified
    amount: Decimal = Field(gt=0)
    bank_name: str | None = None
    is_estimated: bool = False
    note: str | None = None


class WireFeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    wire_id: int
    fee_type: str
    bank_name: str | None
    amount: Decimal
    is_estimated: bool
    note: str | None


class UsWireRow(BaseModel):
    """Fila del registro 'US Wire Transfers' (v_us_wire_transfers)."""

    id: int
    trans_no: int
    wire_date: date
    value_date: date | None
    sender: str
    from_bank: str | None
    to_account_id: int
    to_account: str
    to_account_role: str
    disbursement_id: int | None
    disb_no: int | None
    disb_sub: int | None
    reference: str | None
    currency: str
    amount_sent: Decimal
    amount_received: Decimal | None
    note: str | None
    running_balance: Decimal


class ClassifyIn(BaseModel):
    class_code: str  # code de bank_movement_class


class TxUpdate(BaseModel):
    """Edición de un movimiento bancario (bank_tx). Solo campos de ENTRADA.

    Todos opcionales: se aplica lo que venga (model_dump(exclude_unset)). El saldo
    (`balance`) es derivado y NO se edita acá. `class_code` reusa el catálogo
    bank_movement_class; `account_id`, otra cuenta existente.
    """

    tx_date: date | None = None
    txn_no: str | None = None
    description: str | None = None
    debit: Decimal | None = None
    credit: Decimal | None = None
    account_id: int | None = None
    class_code: str | None = None


# --- Conciliación bancaria ---------------------------------------------------


class ReconcileIn(BaseModel):
    """Liga (o desliga) un movimiento del banco a una fila del Ledger."""

    sheet_row_id: int | None = None  # None = desligar
    note: str | None = None


class MatchPair(BaseModel):
    tx_id: int
    sheet_row_id: int


class ApplyMatchesIn(BaseModel):
    pairs: list[MatchPair]
