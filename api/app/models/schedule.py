"""Cronograma — celdas semanales (§6 del esquema).

La celda se materializa sólo cuando tiene dato. El rango de semanas para pintar
la grilla sale de las celdas existentes (o de settings, si algún día se fija).
Triggers de la base: week_is_monday (CHECK) y cell_amount_matches_state.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import BigInteger, Date, ForeignKey, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ScheduleCell(Base):
    __tablename__ = "schedule_cell"
    __table_args__ = (UniqueConstraint("wbs_id", "week_start"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    wbs_id: Mapped[int] = mapped_column(ForeignKey("wbs_item.id", ondelete="CASCADE"))
    week_start: Mapped[date] = mapped_column(Date)
    planned_amount: Mapped[Decimal | None] = mapped_column(Numeric(16, 2))
    state_id: Mapped[int] = mapped_column(ForeignKey("task_state.id"))
    note: Mapped[str | None] = mapped_column(Text)
