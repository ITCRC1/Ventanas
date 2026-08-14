"""Facturas — §10 del esquema. Captura con detalle por línea y reparto entre WBS."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import BigInteger, Date, ForeignKey, Integer, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class Invoice(Base):
    __tablename__ = "invoice"
    __table_args__ = (UniqueConstraint("payee_id", "invoice_no"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    invoice_no: Mapped[str] = mapped_column(Text)
    payee_id: Mapped[int] = mapped_column(ForeignKey("payee.id"))
    issue_date: Mapped[date] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    currency: Mapped[str] = mapped_column(Text, default="USD")
    subtotal: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    tax: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    total: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="active")  # 'active' | 'void' (anulada)

    lines: Mapped[list[InvoiceLine]] = relationship(
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceLine.line_no",
    )


class InvoiceLine(Base):
    __tablename__ = "invoice_line"
    __table_args__ = (UniqueConstraint("invoice_id", "line_no"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoice.id", ondelete="CASCADE"))
    line_no: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(14, 4))
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(16, 4))
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))
    wbs_id: Mapped[int | None] = mapped_column(ForeignKey("wbs_item.id"))

    invoice: Mapped[Invoice] = relationship(back_populates="lines")
