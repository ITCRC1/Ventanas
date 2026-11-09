"""El tablero del inversionista — JSON para la pantalla.

El cálculo vive en `services/tablero.py`. Acá no hay aritmética a propósito:
si el router calculara algo, ese algo no estaría en el Excel ni en ningún otro
lado, y un día las dos cifras dirían cosas distintas.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.deps import get_current_user, get_db
from app.services import tablero as svc

router = APIRouter(
    prefix="/dashboard",
    tags=["tablero"],
    dependencies=[Depends(get_current_user)],
)

_can_view = Depends(require_permission("report.view"))


@router.get("/summary", dependencies=[_can_view])
def resumen(
    dias: int = Query(svc.DIAS_CAJA, ge=7, le=365),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Los cuatro bloques: en qué termina, qué avisa, cómo viene y qué falta."""
    return svc.construir(db, dias)
