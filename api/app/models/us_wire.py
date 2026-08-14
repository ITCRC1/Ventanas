"""Espejo de la hoja 'US Wire Transfers' — control de aportes de los dueños."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import BigInteger, Date, Integer, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class UsWireRow(Base):
    __tablename__ = "us_wire_row"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    block: Mapped[str] = mapped_column(Text)  # 'ventanas_i' | 'ventanas_ii'
    trans_label: Mapped[str | None] = mapped_column(Text)
    wire_date: Mapped[date | None] = mapped_column(Date)
    sender: Mapped[str | None] = mapped_column(Text)
    from_party: Mapped[str | None] = mapped_column(Text)
    to_party: Mapped[str | None] = mapped_column(Text)
    account_number: Mapped[str | None] = mapped_column(Text)
    amount_received: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=0)
    amount_sent: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    notas: Mapped[str | None] = mapped_column(Text)
