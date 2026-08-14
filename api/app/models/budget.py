"""Presupuesto versionado (§5 del esquema)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class BudgetVersion(Base):
    __tablename__ = "budget_version"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version_no: Mapped[int] = mapped_column(Integer, unique=True)
    effective_date: Mapped[date] = mapped_column(Date)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("app_user.id"))
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(Text)


class BudgetLine(Base):
    __tablename__ = "budget_line"
    __table_args__ = (UniqueConstraint("wbs_id", "version_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    wbs_id: Mapped[int] = mapped_column(ForeignKey("wbs_item.id", ondelete="CASCADE"))
    version_id: Mapped[int] = mapped_column(ForeignKey("budget_version.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(16, 2))
