"""WBS — CRUD + reasignación de categoría/fase (el corazón del Job Cost Report)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.deps import get_current_user, get_db
from app.models.wbs import WbsItem
from app.repositories import wbs as repo
from app.schemas.wbs import WbsFinancialsOut, WbsIn, WbsOut, WbsReassign, WbsUpdate
from app.services import wbs as service

router = APIRouter(prefix="/wbs", tags=["wbs"], dependencies=[Depends(get_current_user)])

_can_edit = Depends(require_permission("wbs.edit"))


@router.get("", response_model=list[WbsOut])
def list_wbs(
    only_active: bool = True,
    limit: int = Query(default=500, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[WbsItem]:
    return repo.list_wbs(db, only_active=only_active, limit=limit, offset=offset)


@router.get("/financials", response_model=list[WbsFinancialsOut])
def wbs_financials(db: Session = Depends(get_db)) -> list[dict[str, object]]:
    """v_wbs_financials: presupuesto original/revisado, gasto y remanente por línea."""
    return repo.financials(db)


@router.get("/{wbs_id}", response_model=WbsOut)
def get_wbs(wbs_id: int, db: Session = Depends(get_db)) -> WbsItem:
    from app.core.problems import Problem

    item = repo.get_wbs(db, wbs_id)
    if item is None:
        raise Problem(status_code=404, title="WBS no encontrado")
    return item


@router.post("", response_model=WbsOut, status_code=201, dependencies=[_can_edit])
def create_wbs(data: WbsIn, db: Session = Depends(get_db)) -> WbsItem:
    return service.create_wbs(db, data)


@router.patch("/{wbs_id}", response_model=WbsOut, dependencies=[_can_edit])
def update_wbs(wbs_id: int, data: WbsUpdate, db: Session = Depends(get_db)) -> WbsItem:
    return service.update_wbs(db, wbs_id, data)


@router.put("/{wbs_id}/assignment", response_model=WbsOut, dependencies=[_can_edit])
def reassign(wbs_id: int, data: WbsReassign, db: Session = Depends(get_db)) -> WbsItem:
    return service.reassign(db, wbs_id, data)
