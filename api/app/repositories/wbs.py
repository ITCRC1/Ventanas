"""Acceso a datos del WBS."""

from __future__ import annotations

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.wbs import WbsItem


def list_wbs(
    db: Session, *, only_active: bool = True, limit: int = 500, offset: int = 0
) -> list[WbsItem]:
    stmt = (
        select(WbsItem).order_by(WbsItem.sort_order, WbsItem.wbs_code).limit(limit).offset(offset)
    )
    if only_active:
        stmt = stmt.where(WbsItem.is_active.is_(True))
    return list(db.execute(stmt).scalars())


def get_wbs(db: Session, wbs_id: int) -> WbsItem | None:
    return db.get(WbsItem, wbs_id)


def get_wbs_by_code(db: Session, code: str) -> WbsItem | None:
    return db.execute(select(WbsItem).where(WbsItem.wbs_code == code)).scalar_one_or_none()


def add(db: Session, item: WbsItem) -> WbsItem:
    db.add(item)
    db.flush()
    return item


def financials(db: Session, *, wbs_id: int | None = None) -> list[dict[str, object]]:
    """v_wbs_financials — SQL crudo (§1 DECISIONES: sin ORM para reportes)."""
    sql = "SELECT * FROM v_wbs_financials"
    params: dict[str, object] = {}
    if wbs_id is not None:
        sql += " WHERE id = :wid"
        params["wid"] = wbs_id
    sql += " ORDER BY wbs_code"
    rows = db.execute(text(sql), params).mappings().all()
    return [dict(r) for r in rows]
