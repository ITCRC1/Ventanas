"""Lógica de negocio del ledger.

Las reglas duras (pago exige fecha, released exige motivo) son constraints de la
base. La app no recalcula amount_usd/amount_due: son columnas generadas.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.problems import Problem
from app.models.ledger import LedgerEntry
from app.repositories import ledger as repo
from app.schemas.ledger import LedgerIn, LedgerUpdate


def create_entry(db: Session, data: LedgerIn) -> LedgerEntry:
    entry = LedgerEntry(**data.model_dump())
    return repo.add(db, entry)


def _require(db: Session, entry_id: int) -> LedgerEntry:
    entry = repo.get_entry(db, entry_id)
    if entry is None:
        raise Problem(status_code=404, title="Asiento no encontrado")
    return entry


def update_entry(db: Session, entry_id: int, data: LedgerUpdate) -> LedgerEntry:
    entry = _require(db, entry_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(entry, field, value)
    db.flush()
    db.refresh(entry)
    return entry
