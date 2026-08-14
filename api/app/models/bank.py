"""Bancos, wires y comisiones — §9 del esquema.

wire_fees_balance es un CONSTRAINT TRIGGER DEFERRED: enviado − comisiones = recibido,
y rechaza asignar MÁS comisión que la diferencia real. Se fuerza IMMEDIATE en el
service para devolver el error de forma síncrona (mismo patrón que el crédito).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import BigInteger, Boolean, Date, ForeignKey, Integer, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class BankAccount(Base):
    __tablename__ = "bank_account"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    role: Mapped[str] = mapped_column(Text, default="operating")
    iban: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(Text, default="USD")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class WireTransfer(Base):
    __tablename__ = "wire_transfer"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    disbursement_id: Mapped[int | None] = mapped_column(ForeignKey("disbursement.id"))
    wire_date: Mapped[date] = mapped_column(Date)
    value_date: Mapped[date | None] = mapped_column(Date)
    sender: Mapped[str] = mapped_column(Text, default="Hovde Master LLC")
    from_bank: Mapped[str | None] = mapped_column(Text)
    to_account_id: Mapped[int] = mapped_column(ForeignKey("bank_account.id"))
    currency: Mapped[str] = mapped_column(Text, default="USD")
    amount_sent: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    amount_received: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    reference: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)


class WireFee(Base):
    __tablename__ = "wire_fee"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    wire_id: Mapped[int] = mapped_column(ForeignKey("wire_transfer.id", ondelete="CASCADE"))
    fee_type: Mapped[str] = mapped_column(ForeignKey("fee_type.code"))
    bank_name: Mapped[str | None] = mapped_column(Text)
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    is_estimated: Mapped[bool] = mapped_column(Boolean, default=False)
    ledger_entry_id: Mapped[int | None] = mapped_column(BigInteger)
    note: Mapped[str | None] = mapped_column(Text)


class FeeType(Base):
    __tablename__ = "fee_type"

    code: Mapped[str] = mapped_column(Text, primary_key=True)
    label: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
