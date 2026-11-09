"""Export — modelo Excel vivo (.xlsx) generado desde la base."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.deps import get_db
from app.export.excel import build_excel

router = APIRouter(
    prefix="/export",
    tags=["export"],
    dependencies=[Depends(require_permission("report.view"))],
)

_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/excel")
def export_excel(
    start: date | None = Query(default=None, description="Lunes inicial (opcional)"),
    end: date | None = Query(default=None, description="Lunes final (opcional)"),
    db: Session = Depends(get_db),
) -> Response:
    """Descarga el modelo vivo. Rango por defecto = todo el cronograma cargado."""
    content = build_excel(db, start, end)
    # ⚠️ La fecha en el nombre. Antes todas las descargas se llamaban igual, asi
    # que Windows las guardaba como "(9)", "(10)"… y era imposible saber cual
    # era la de hoy: el owner abria una vieja y veia numeros que ya no existen.
    filename = f"Ventanas Master File {date.today():%Y-%m-%d}.xlsx"
    return Response(
        content=content,
        media_type=_XLSX,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # El libro se arma de cero en cada llamada y refleja la base de ese
            # momento. Sin esto el navegador puede servir una copia guardada y
            # mostrar el presupuesto de ayer sin que nada avise.
            "Cache-Control": "no-store, max-age=0",
        },
    )
