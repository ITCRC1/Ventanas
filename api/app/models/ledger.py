"""Ledger — registro de compromisos y pagos (§11 del esquema).

amount_usd, amount_paid_usd y amount_due son columnas GENERADAS por Postgres:
se leen, nunca se escriben. La app no recalcula montos (§6 DECISIONES).
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import BigInteger, Computed, Date, ForeignKey, Integer, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class LedgerStatus(Base):
    __tablename__ = "ledger_status"

    code: Mapped[str] = mapped_column(Text, primary_key=True)
    label: Mapped[str] = mapped_column(Text)
    generates_credit: Mapped[bool] = mapped_column(default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class LedgerEntry(Base):
    __tablename__ = "ledger_entry"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    wbs_id: Mapped[int | None] = mapped_column(ForeignKey("wbs_item.id"))
    disbursement_id: Mapped[int | None] = mapped_column(Integer)
    invoice_id: Mapped[int | None] = mapped_column(BigInteger)
    payee_id: Mapped[int | None] = mapped_column(Integer)
    bank_tx_id: Mapped[int | None] = mapped_column(BigInteger)
    entry_date: Mapped[date | None] = mapped_column(Date)
    invoice_no: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(Text, default="USD")
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(16, 6), default=Decimal(1))
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal(0))
    funding_source: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(ForeignKey("ledger_status.code"), default="pending")
    released_reason: Mapped[str | None] = mapped_column(Text)

    # --- columnas GENERADAS por Postgres (solo lectura; nunca en INSERT/UPDATE) ---
    amount_usd: Mapped[Decimal] = mapped_column(
        Numeric(16, 2), Computed("ROUND(amount * fx_rate, 2)", persisted=True)
    )
    amount_paid_usd: Mapped[Decimal] = mapped_column(
        Numeric(16, 2), Computed("ROUND(amount_paid * fx_rate, 2)", persisted=True)
    )
    amount_due: Mapped[Decimal] = mapped_column(
        Numeric(16, 2), Computed("amount - amount_paid", persisted=True)
    )

    __mapper_args__ = {"eager_defaults": True}
