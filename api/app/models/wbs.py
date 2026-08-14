"""WBS — el regente. Categoría y fase viven SÓLO aquí (§4 del esquema)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class WbsItem(Base):
    __tablename__ = "wbs_item"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    wbs_code: Mapped[str] = mapped_column(Text, unique=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("wbs_item.id"))
    title: Mapped[str] = mapped_column(Text)
    owner: Mapped[str | None] = mapped_column(Text)
    forecast_total: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    # Overrides manuales del Job Cost (Excel): si están, la vista los usa.
    budget_original_ovr: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    budget_change_ovr: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    spend_ovr: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    # Fechas del Job Cost (Excel: START DATE / DUE DATE). DURATION = DAYS360 en la vista.
    start_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("category.id"))
    phase_id: Mapped[int | None] = mapped_column(ForeignKey("phase.id"))
    state_id: Mapped[int] = mapped_column(ForeignKey("task_state.id"), default=1)
    kind: Mapped[str] = mapped_column(ForeignKey("line_type.code"), default="cost")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
