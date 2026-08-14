"""Lógica de negocio del WBS.

La validación categoría↔fase la hace un trigger en la base; aquí sólo traducimos
sus errores (IntegrityError/ProgrammingError) al capturador RFC 7807.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.problems import Problem
from app.models.wbs import WbsItem
from app.repositories import wbs as repo
from app.schemas.wbs import WbsIn, WbsReassign, WbsUpdate


def create_wbs(db: Session, data: WbsIn) -> WbsItem:
    if repo.get_wbs_by_code(db, data.wbs_code):
        raise Problem(
            status_code=409,
            title="WBS duplicado",
            detail=f"Ya existe una línea con código «{data.wbs_code}».",
        )
    item = WbsItem(**data.model_dump())
    return repo.add(db, item)


def _require(db: Session, wbs_id: int) -> WbsItem:
    item = repo.get_wbs(db, wbs_id)
    if item is None:
        raise Problem(status_code=404, title="WBS no encontrado")
    return item


def update_wbs(db: Session, wbs_id: int, data: WbsUpdate) -> WbsItem:
    item = _require(db, wbs_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    db.flush()
    db.refresh(item)  # los triggers pueden ajustar la fila (p.ej. limpiar la fase)
    return item


def reassign(db: Session, wbs_id: int, data: WbsReassign) -> WbsItem:
    """Reasignar categoría/fase — la operación central del Job Cost Report."""
    item = _require(db, wbs_id)
    item.category_id = data.category_id
    item.phase_id = data.phase_id
    db.flush()  # dispara el trigger wbs_enforce_category_phase
    # El trigger puede poner phase_id=NULL si la fase no aplica a la nueva
    # categoría; refrescamos para devolver el estado real, no el que pedimos.
    db.refresh(item)
    return item
