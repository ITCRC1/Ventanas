"""Propuesta de presupuesto anual — JSON para la pantalla y .xlsx para bajar.

El cálculo vive en `services/presupuesto.py` y es UNO solo: la pantalla y el
Excel leen lo mismo. Tenerlo dos veces es garantizar que un día digan cosas
distintas y nadie sepa cuál creer.
"""

from __future__ import annotations

import datetime as dt
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.permissions import require_any_permission, require_permission
from app.deps import get_db
from app.export.presupuesto_excel import propuesta_a_xlsx
from app.services import presupuesto as svc

router = APIRouter(
    prefix="/budget-proposal",
    tags=["presupuesto"],
    # Solo /budget-proposal lo consume.
    dependencies=[Depends(require_any_permission("view.budget"))],
)

_can_view = Depends(require_permission("report.view"))
_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _anio(anio: int | None) -> int:
    # Por defecto, el año que viene: es para el que se presupuesta.
    return anio or (dt.date.today().year + 1)


@router.get("", dependencies=[_can_view])
def propuesta(anio: int | None = None, db: Session = Depends(get_db)) -> dict[str, Any]:
    return svc.construir(db, _anio(anio))


@router.get("/export.xlsx", dependencies=[_can_view])
def exportar(anio: int | None = None, db: Session = Depends(get_db)) -> Response:
    y = _anio(anio)
    data = propuesta_a_xlsx(svc.construir(db, y))
    # ⚠️ La fecha en el nombre y `no-store`, por lo mismo que el Master File: el
    # libro se arma de cero en cada llamada, pero sin esta cabecera el navegador
    # puede servir una copia guardada y mostrar el presupuesto de ayer sin que
    # nada avise. Y con el nombre siempre igual, Windows apila "(9)", "(10)"… y
    # no hay manera de saber cual es el de hoy.
    nombre = f"Presupuesto_{y}_Ventanas_{date.today():%Y-%m-%d}.xlsx"
    return Response(
        data,
        media_type=_XLSX,
        headers={
            "Content-Disposition": f'attachment; filename="{nombre}"',
            "Cache-Control": "no-store, max-age=0",
        },
    )
