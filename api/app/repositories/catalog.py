"""Acceso a datos de catálogos."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.catalog import Category, LineType, Phase, TaskState


def list_categories(db: Session, *, only_active: bool = False) -> list[Category]:
    stmt = select(Category).order_by(Category.sort_order, Category.code)
    if only_active:
        stmt = stmt.where(Category.is_active.is_(True))
    return list(db.execute(stmt).scalars())


def get_category(db: Session, category_id: int) -> Category | None:
    return db.get(Category, category_id)


def list_phases(db: Session, *, category_id: int | None = None) -> list[Phase]:
    stmt = select(Phase).order_by(Phase.category_id, Phase.sort_order, Phase.code)
    if category_id is not None:
        stmt = stmt.where(Phase.category_id == category_id)
    return list(db.execute(stmt).scalars())


def get_phase(db: Session, phase_id: int) -> Phase | None:
    return db.get(Phase, phase_id)


def list_task_states(db: Session) -> list[TaskState]:
    return list(db.execute(select(TaskState).order_by(TaskState.sort_order)).scalars())


def list_line_types(db: Session) -> list[LineType]:
    return list(db.execute(select(LineType).order_by(LineType.code)).scalars())
