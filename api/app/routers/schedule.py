"""Cronograma — celdas semanales, rango de semanas, upsert y limpieza."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.deps import get_current_user, get_db
from app.models.schedule import ScheduleCell
from app.repositories import schedule as repo
from app.schemas.schedule import CellIn, CellOut, CellsBulkIn, WeeksOut
from app.services import schedule as service

router = APIRouter(
    prefix="/schedule", tags=["cronograma"], dependencies=[Depends(get_current_user)]
)

_can_edit = Depends(require_permission("schedule.edit"))


class CutoffIn(BaseModel):
    cutoff_date: date


@router.get("/cutoff")
def get_cutoff(db: Session = Depends(get_db)) -> dict[str, date | None]:
    """Fecha de corte del Forecast (el timeline desde acá cuenta como futuro)."""
    row = db.execute(text("SELECT cutoff_date FROM settings LIMIT 1")).first()
    return {"cutoff_date": row[0] if row else None}


@router.put("/cutoff", dependencies=[_can_edit])
def set_cutoff(data: CutoffIn, db: Session = Depends(get_db)) -> dict[str, date]:
    db.execute(text("UPDATE settings SET cutoff_date = :d"), {"d": data.cutoff_date})
    db.commit()
    return {"cutoff_date": data.cutoff_date}


@router.get("/weeks", response_model=WeeksOut)
def weeks(db: Session = Depends(get_db)) -> WeeksOut:
    start, end = repo.week_bounds(db)
    return WeeksOut(start=start, end=end, weeks=repo.contiguous_weeks(start, end))


@router.get("/cells", response_model=list[CellOut])
def cells(
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[ScheduleCell]:
    return repo.list_cells(db, date_from=date_from, date_to=date_to)


@router.put("/cell", response_model=CellOut, dependencies=[_can_edit])
def upsert_cell(data: CellIn, db: Session = Depends(get_db)) -> ScheduleCell:
    return service.upsert_cell(db, data)


@router.put("/cells", dependencies=[_can_edit])
def upsert_cells(data: CellsBulkIn, db: Session = Depends(get_db)) -> dict[str, object]:
    """Guardado por LOTE (pegar desde Excel / rellenar / borrar en bloque)."""
    n = service.upsert_cells_bulk(db, data.cells)
    return {"ok": True, "count": n}


@router.delete("/cell", status_code=204, dependencies=[_can_edit])
def clear_cell(
    wbs_id: int,
    week_start: date,
    db: Session = Depends(get_db),
) -> Response:
    service.clear_cell(db, wbs_id, week_start)
    return Response(status_code=204)
