"""WBS — CRUD + reasignación de categoría/fase (el corazón del Job Cost Report)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
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


# ⚠️ `/by-owner` va ANTES de `/{wbs_id}`: FastAPI resuelve las rutas en el
# orden en que se declaran, y declarada despues, una llamada a /wbs/by-owner
# cae en el parametro de ruta y nunca llega aca.
@router.get("/by-owner")
def wbs_by_owner(
    owner: str = Query(..., description="dueño de la tarea, p.ej. DEHC"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Qué tiene a cargo un proveedor: presupuesto, gasto y lo que falta.

    Owner, 2026-10-23, al ver DEHC en la columna Owner del Timeline Detail:
    *«necesito sub tabs, 1 para las facturas y 2 para el presupuesto… y otro tab
    para lo pendiente, meter en qué fecha aparecen en el schedule los pendientes
    como un mini job cost»*.

    ## Por qué `owner` y no las facturas

    La pantalla de facturas contesta qué nos cobran. Ésta contesta algo que las
    facturas no saben: **qué le encargamos**. El `owner` de la línea del WBS es
    quien responde por la tarea, y ahí DEHC aparece en doce líneas por
    $413,944.70 — la mitad de ellas sin una sola factura todavía.

    ⚠️ Es un campo de TEXTO escrito a mano, no una llave contra `payee`. Se
    busca con ILIKE y puede traer variantes. No sirve para cuadrar plata: sirve
    para saber a quién reclamarle.

    Devuelve las tres cosas juntas porque se leen juntas: la línea, lo que ya
    se le pagó y en qué semanas el cronograma espera el resto.
    """
    lineas = (
        db.execute(
            text(
                """
                SELECT f.wbs_code, f.title, f.owner, f.category, f.phase, f.state,
                       f.budget_revised, f.spend, f.remaining, f.forecast, f.over_under,
                       f.start_date, f.due_date
                FROM v_wbs_financials f
                JOIN wbs_item w ON w.wbs_code = f.wbs_code
                WHERE w.owner ILIKE '%' || :o || '%' AND w.is_active
                ORDER BY f.wbs_code
                """
            ),
            {"o": owner},
        )
        .mappings()
        .all()
    )
    codigos = [r["wbs_code"] for r in lineas]
    pagos: dict[str, list[dict[str, Any]]] = {}
    cronograma: dict[str, list[dict[str, Any]]] = {}
    if codigos:
        for r in (
            db.execute(
                text(
                    """
                    SELECT id, cost_code, entry_date, payee, description,
                           amount, amount_paid, amount_due, invoice_no
                    FROM ledger_sheet_row
                    WHERE kind = 'data' AND cost_code = ANY(:c)
                    ORDER BY entry_date NULLS LAST, id
                    """
                ),
                {"c": codigos},
            )
            .mappings()
            .all()
        ):
            pagos.setdefault(r["cost_code"], []).append(dict(r))

        for r in (
            db.execute(
                text(
                    """
                    SELECT w.wbs_code, s.week_start, s.planned_amount,
                           ts.label AS state, s.note
                    FROM schedule_cell s
                    JOIN wbs_item w ON w.id = s.wbs_id
                    LEFT JOIN task_state ts ON ts.id = s.state_id
                    WHERE w.wbs_code = ANY(:c) AND COALESCE(s.planned_amount, 0) <> 0
                    ORDER BY s.week_start
                    """
                ),
                {"c": codigos},
            )
            .mappings()
            .all()
        ):
            cronograma.setdefault(r["wbs_code"], []).append(dict(r))

    corte = db.execute(text("SELECT cutoff_date FROM settings LIMIT 1")).scalar()
    return {
        "owner": owner,
        "cutoff_date": corte,
        "lines": [dict(r) for r in lineas],
        "payments": pagos,
        "schedule": cronograma,
    }

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
