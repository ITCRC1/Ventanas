"""Catálogos: categorías, fases, estados, tipos de línea."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.core.problems import Problem
from app.deps import get_current_user, get_db
from app.models.catalog import Category, LineType, Phase, TaskState
from app.repositories import catalog as repo
from app.schemas.catalog import (
    CategoryIn,
    CategoryOut,
    CategoryUpdate,
    LineTypeOut,
    PhaseIn,
    PhaseOut,
    PhaseUpdate,
    ProjectMetaOut,
    TaskStateOut,
)

router = APIRouter(tags=["catálogos"], dependencies=[Depends(get_current_user)])

_can_edit = Depends(require_permission("wbs.edit"))

# --- Categorías -------------------------------------------------------------
cat = APIRouter(prefix="/categories")


@cat.get("", response_model=list[CategoryOut])
def list_categories(only_active: bool = False, db: Session = Depends(get_db)) -> list[Category]:
    return repo.list_categories(db, only_active=only_active)


@cat.post("", response_model=CategoryOut, status_code=201, dependencies=[_can_edit])
def create_category(data: CategoryIn, db: Session = Depends(get_db)) -> Category:
    obj = Category(**data.model_dump())
    db.add(obj)
    db.flush()
    return obj


@cat.patch("/{category_id}", response_model=CategoryOut, dependencies=[_can_edit])
def update_category(
    category_id: int, data: CategoryUpdate, db: Session = Depends(get_db)
) -> Category:
    obj = repo.get_category(db, category_id)
    if obj is None:
        raise Problem(status_code=404, title="Categoría no encontrada")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    db.flush()
    return obj


# --- Fases ------------------------------------------------------------------
ph = APIRouter(prefix="/phases")


@ph.get("", response_model=list[PhaseOut])
def list_phases(category_id: int | None = None, db: Session = Depends(get_db)) -> list[Phase]:
    return repo.list_phases(db, category_id=category_id)


@ph.post("", response_model=PhaseOut, status_code=201, dependencies=[_can_edit])
def create_phase(data: PhaseIn, db: Session = Depends(get_db)) -> Phase:
    obj = Phase(**data.model_dump())
    db.add(obj)
    db.flush()
    return obj


@ph.patch("/{phase_id}", response_model=PhaseOut, dependencies=[_can_edit])
def update_phase(phase_id: int, data: PhaseUpdate, db: Session = Depends(get_db)) -> Phase:
    obj = repo.get_phase(db, phase_id)
    if obj is None:
        raise Problem(status_code=404, title="Fase no encontrada")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    db.flush()
    return obj


# --- Estados y tipos (solo lectura) -----------------------------------------
meta = APIRouter(prefix="/meta")


@meta.get("/task-states", response_model=list[TaskStateOut])
def list_states(db: Session = Depends(get_db)) -> list[TaskState]:
    return repo.list_task_states(db)


@meta.get("/line-types", response_model=list[LineTypeOut])
def list_line_types(db: Session = Depends(get_db)) -> list[LineType]:
    return repo.list_line_types(db)


@meta.get("/project", response_model=ProjectMetaOut)
def project_meta(db: Session = Depends(get_db)) -> ProjectMetaOut:
    """Cabecera del Job Cost: título, PM, empresa, moneda, corte y última actualización."""
    row = db.execute(
        text(
            "SELECT project_name, company, manager, report_currency, "
            "cutoff_date, horizon_start, horizon_end, updated_at "
            "FROM settings LIMIT 1"
        )
    ).mappings().first()
    if row is None:
        return ProjectMetaOut(
            project_name=None,
            company=None,
            manager=None,
            report_currency=None,
            cutoff_date=None,
            horizon_start=None,
            horizon_end=None,
            updated_at=None,
        )
    return ProjectMetaOut(**dict(row))


router.include_router(cat)
router.include_router(ph)
router.include_router(meta)
