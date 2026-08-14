"""Acceso a datos del cronograma."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.schedule import ScheduleCell


def list_cells(
    db: Session, *, date_from: date | None = None, date_to: date | None = None
) -> list[ScheduleCell]:
    stmt = select(ScheduleCell).order_by(ScheduleCell.wbs_id, ScheduleCell.week_start)
    if date_from is not None:
        stmt = stmt.where(ScheduleCell.week_start >= date_from)
    if date_to is not None:
        stmt = stmt.where(ScheduleCell.week_start <= date_to)
    return list(db.execute(stmt).scalars())


def get_cell(db: Session, wbs_id: int, week_start: date) -> ScheduleCell | None:
    return db.execute(
        select(ScheduleCell).where(
            ScheduleCell.wbs_id == wbs_id, ScheduleCell.week_start == week_start
        )
    ).scalar_one_or_none()


def week_bounds(db: Session) -> tuple[date | None, date | None]:
    """Rango de semanas a pintar: de settings si existe, si no de las celdas."""
    row = db.execute(text("SELECT horizon_start, horizon_end FROM settings LIMIT 1")).first()
    if row and row[0] and row[1]:
        return row[0], row[1]
    row = db.execute(text("SELECT min(week_start), max(week_start) FROM schedule_cell")).first()
    return (row[0], row[1]) if row else (None, None)


def contiguous_weeks(start: date | None, end: date | None) -> list[date]:
    """Todas las semanas (lunes) entre start y end, inclusive."""
    if start is None or end is None:
        return []
    # normalizar a lunes
    start -= timedelta(days=start.weekday())
    end -= timedelta(days=end.weekday())
    weeks: list[date] = []
    cur = start
    while cur <= end:
        weeks.append(cur)
        cur += timedelta(days=7)
    return weeks
