"""Reportes — vistas del esquema consultadas con SQL crudo (§1 DECISIONES).

Sólo lectura. Requieren el permiso report.view. Nada se recalcula en la app:
los totales, saldos y prorrateos ya viven en las vistas de la base.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.deps import get_db

router = APIRouter(
    prefix="/reports",
    tags=["reportes"],
    dependencies=[Depends(require_permission("report.view"))],
)

# Vistas expuestas como reportes de solo lectura. La whitelist evita inyección
# por nombre de vista y documenta qué se publica.
_VIEWS: dict[str, str] = {
    "ledger": "v_ledger",
    "budget-vs-actual": "v_budget_vs_actual",
    "timeline": "v_timeline",
    "timeline-detail": "v_timeline_detail",
    "reassignment-queue": "v_reassignment_queue",
    "disbursement-trace": "v_disbursement_trace",
    "disbursement-gaps": "v_disbursement_gaps",
    "credit-ledger": "v_credit_ledger",
    "credit-balance": "v_credit_balance",
    "wire-reconciliation": "v_wire_reconciliation",
    "wire-pending": "v_wire_pending",
    "bank-fees": "v_bank_fees",
    "bank-charges-monthly": "v_bank_charges_monthly",
    "charges-pending-recovery": "v_charges_pending_recovery",
}


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


@router.get("")
def list_reports() -> dict[str, list[str]]:
    return {"reports": sorted(_VIEWS)}


@router.get("/{name}")
def get_report(
    name: str,
    limit: int = 500,
    offset: int = 0,
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    from app.core.problems import Problem

    view = _VIEWS.get(name)
    if view is None:
        raise Problem(status_code=404, title="Reporte desconocido", detail=f"«{name}» no existe.")
    return _query_view(db, view, min(limit, 500), max(offset, 0))
