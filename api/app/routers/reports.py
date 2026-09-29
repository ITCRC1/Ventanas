"""Reportes — vistas del esquema consultadas con SQL crudo (§1 DECISIONES).

Sólo lectura. Requieren el permiso report.view. Nada se recalcula en la app:
los totales, saldos y prorrateos ya viven en las vistas de la base.

El catálogo (títulos, etiquetas de columna y tipos) vive en app/reports_catalog.py
porque estos reportes se mandan afuera y los nombres crudos de las vistas no
sirven para eso.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.core.problems import Problem
from app.deps import get_db
from app.export import report_xlsx
from app.reports_catalog import GROUPS, REPORTS

router = APIRouter(
    prefix="/reports",
    tags=["reportes"],
    dependencies=[Depends(require_permission("report.view"))],
)

# Nombre de vista por reporte. La whitelist evita inyección y documenta qué se
# publica; se deriva del catálogo para no mantener dos listas.
_VIEWS: dict[str, str] = {k: v["view"] for k, v in REPORTS.items()}

_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _query_view(db: Session, view: str, limit: int, offset: int) -> list[dict[str, Any]]:
    rows = (
        db.execute(
            text(f"SELECT * FROM {view} LIMIT :lim OFFSET :off"),  # noqa: S608 — view viene de whitelist
            {"lim": limit, "off": offset},
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


def _require(name: str) -> dict[str, Any]:
    rep = REPORTS.get(name)
    if rep is None:
        raise Problem(status_code=404, title="Reporte desconocido", detail=f"«{name}» no existe.")
    return rep


def _cutoff(db: Session) -> date | None:
    return db.execute(text("SELECT cutoff_date FROM settings LIMIT 1")).scalar()


@router.get("")
def list_reports(db: Session = Depends(get_db)) -> dict[str, Any]:
    """Catálogo para la pantalla de Reporting: qué hay, cómo se llama y cuánto trae."""
    salida, vacios = [], 0
    for name, rep in REPORTS.items():
        n = int(db.execute(text(f"SELECT count(*) FROM {rep['view']}")).scalar() or 0)  # noqa: S608
        # Un reporte sin filas no se publica: no se manda afuera una hoja en
        # blanco. No se borra del catalogo — vuelve a aparecer solo el dia que
        # tenga datos, que es justo cuando interesa (p.ej. huecos de numeracion).
        if n == 0:
            vacios += 1
            continue
        salida.append({
            "name": name,
            "title": rep["title"],
            "blurb": rep["blurb"],
            "group": rep["group"],
            "columns": rep["cols"],
            "rows": n,
        })
    salida.sort(key=lambda r: (GROUPS.index(r["group"]), r["title"]))
    return {
        "groups": GROUPS,
        "reports": salida,
        "cutoff_date": _cutoff(db),
        "hidden_empty": vacios,
    }


@router.get("/{name}/export.xlsx")
def export_report(name: str, db: Session = Depends(get_db)) -> Response:
    """El reporte completo en Excel, con encabezado y totales. Sin tope de filas."""
    rep = _require(name)
    filas = _query_view(db, rep["view"], 100_000, 0)
    blob = report_xlsx.build(
        title=rep["title"], blurb=rep["blurb"], columns=rep["cols"],
        rows=filas, cutoff=_cutoff(db),
    )
    archivo = f"Ventanas_{name.replace('-', '_')}.xlsx"
    return Response(
        blob, media_type=_XLSX,
        headers={"Content-Disposition": f'attachment; filename="{archivo}"'},
    )


@router.get("/{name}")
def get_report(
    name: str,
    limit: int = 500,
    offset: int = 0,
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    rep = _require(name)
    return _query_view(db, rep["view"], min(limit, 500), max(offset, 0))
