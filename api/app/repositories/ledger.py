"""Acceso a datos del ledger."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.ledger import LedgerEntry


def list_entries(
    db: Session,
    *,
    status: str | None = None,
    wbs_id: int | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[LedgerEntry]:
    stmt = select(LedgerEntry).order_by(LedgerEntry.entry_date.desc().nullslast(), LedgerEntry.id)
    if status is not None:
        stmt = stmt.where(LedgerEntry.status == status)
    if wbs_id is not None:
        stmt = stmt.where(LedgerEntry.wbs_id == wbs_id)
    return list(db.execute(stmt.limit(limit).offset(offset)).scalars())


def get_entry(db: Session, entry_id: int) -> LedgerEntry | None:
    return db.get(LedgerEntry, entry_id)


def add(db: Session, entry: LedgerEntry) -> LedgerEntry:
    db.add(entry)
    db.flush()
    db.refresh(entry)  # trae las columnas generadas (amount_usd, etc.)
    return entry
