"""Planning — anotaciones de revisión/aprobación del tab Planning.

Notas por número de proyecto (wbs): nota + monto sugerido + mover-a-mes. Son
INSTRUCCIONES para el Financial Controller — NO tocan el cronograma real. Más un
comentario general del documento (settings.planning_comments).
"""

from __future__ import annotations

import json
import secrets
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.core.problems import Problem
from app.deps import get_current_user, get_db
from app.repositories import schedule as sched_repo
from app.repositories import wbs as wbs_repo
from app.schemas.schedule import CellBulkItem
from app.services import schedule as sched_service

router = APIRouter(prefix="/planning", tags=["planning"], dependencies=[Depends(get_current_user)])

_can_view = Depends(require_permission("report.view"))
_can_edit = Depends(require_permission("schedule.edit"))


class NoteIn(BaseModel):
    wbs_id: int
    note: str | None = None
    suggested_amount: Decimal | None = None
    move_to_month: str | None = None


class CommentsIn(BaseModel):
    comments: str | None = None


@router.get("", dependencies=[_can_view])
def get_planning(db: Session = Depends(get_db)) -> dict[str, Any]:
    row = (
        db.execute(
            text(
                "SELECT planning_comments, planning_share_token, planning_opened_count, "
                "planning_opened_at, planning_last_opened_at FROM settings LIMIT 1"
            )
        )
        .mappings()
        .first()
    )
    rows = (
        db.execute(
            text(
                "SELECT wbs_id, note, suggested_amount, move_to_month, updated_at "
                "FROM planning_note"
            )
        )
        .mappings()
        .all()
    )
    sub_count = db.execute(text("SELECT count(*) FROM planning_link_submission")).scalar()
    return {
        "comments": row["planning_comments"] if row else None,
        "share_token": row["planning_share_token"] if row else None,
        "opened_count": (row["planning_opened_count"] if row else 0) or 0,
        "opened_at": row["planning_opened_at"] if row else None,
        "last_opened_at": row["planning_last_opened_at"] if row else None,
        "submission_count": sub_count or 0,
        "notes": [dict(r) for r in rows],
    }


@router.get("/submissions", dependencies=[_can_view])
def list_link_submissions(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = (
        db.execute(
            text(
                "SELECT id, reviewer_name, comments, notes, submitted_at "
                "FROM planning_link_submission ORDER BY submitted_at DESC"
            )
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


@router.delete("/submissions/{sid}", dependencies=[_can_edit])
def delete_link_submission(sid: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    r = db.execute(
        text("DELETE FROM planning_link_submission WHERE id = :s RETURNING id"), {"s": sid}
    ).first()
    if r is None:
        raise Problem(status_code=404, title="Versión no encontrada")
    return {"ok": True}


@router.put("/note", dependencies=[_can_edit])
def put_note(data: NoteIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    db.execute(
        text(
            """
            INSERT INTO planning_note (wbs_id, note, suggested_amount, move_to_month, updated_at)
            VALUES (:w, :n, :a, :m, now())
            ON CONFLICT (wbs_id) DO UPDATE SET
              note = :n, suggested_amount = :a, move_to_month = :m, updated_at = now()
            """
        ),
        {
            "w": data.wbs_id,
            "n": (data.note or None),
            "a": data.suggested_amount,
            "m": (data.move_to_month or None),
        },
    )
    return {"ok": True}


@router.put("/comments", dependencies=[_can_edit])
def put_comments(data: CommentsIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    db.execute(text("UPDATE settings SET planning_comments = :c"), {"c": data.comments or None})
    return {"ok": True}


class ApplyNoteIn(BaseModel):
    wbs_id: int
    suggested_amount: Decimal | None = None
    move_to_month: str | None = None  # 'YYYY-MM'


def _fmt(x: Decimal) -> str:
    return f"${x:,.0f}"


@router.post("/apply-note", dependencies=[_can_edit])
def apply_note(data: ApplyNoteIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Aplica al cronograma REAL (Job Cost) la instrucción devuelta por el aprobador:
    mover el plan futuro de un proyecto a un mes y/o fijarle un monto. Solo toca meses
    >= cutoff (la historia queda bloqueada). Es OPT-IN: el owner decide si aplicarla."""
    if not data.move_to_month and data.suggested_amount is None:
        raise Problem(status_code=400, title="Nada que aplicar")

    cutoff = db.execute(text("SELECT cutoff_date FROM settings LIMIT 1")).scalar()
    cells = (
        db.execute(
            text(
                "SELECT week_start, planned_amount, state_id FROM schedule_cell "
                "WHERE wbs_id = :w AND planned_amount IS NOT NULL AND planned_amount <> 0 "
                "ORDER BY week_start"
            ),
            {"w": data.wbs_id},
        )
        .mappings()
        .all()
    )
    future = [c for c in cells if cutoff is None or c["week_start"] >= cutoff]
    total_future = sum((Decimal(str(c["planned_amount"])) for c in future), Decimal(0))
    state_id = future[0]["state_id"] if future else None

    start, end = sched_repo.week_bounds(db)
    weeks = sched_repo.contiguous_weeks(start, end)

    items: list[CellBulkItem] = []
    if data.move_to_month:
        cand = [
            w
            for w in weeks
            if w.strftime("%Y-%m") == data.move_to_month and (cutoff is None or w >= cutoff)
        ]
        if not cand:
            raise Problem(
                status_code=400,
                title="Mes destino inválido",
                detail="El mes destino no existe en el cronograma o cae en la historia bloqueada.",
            )
        target_week = min(cand)
        amount = data.suggested_amount if data.suggested_amount is not None else total_future
        for c in future:
            if c["week_start"] != target_week:
                items.append(
                    CellBulkItem(wbs_id=data.wbs_id, week_start=c["week_start"], planned_amount=None)
                )
        items.append(
            CellBulkItem(
                wbs_id=data.wbs_id,
                week_start=target_week,
                planned_amount=amount,
                state_id=state_id,
            )
        )
        desc = (
            f"Plan de #{data.wbs_id} consolidado en {data.move_to_month} = {_fmt(amount)} "
            f"(antes {_fmt(total_future)} repartido en {len(future)} semana(s))."
        )
    else:
        # Solo monto sugerido: fija el monto en el mes futuro más cercano ya planeado
        # (o en la primera semana futura si no hay plan aún).
        if future:
            target_week = future[0]["week_start"]
        else:
            fut_weeks = [w for w in weeks if cutoff is None or w >= cutoff]
            if not fut_weeks:
                raise Problem(status_code=400, title="No hay semanas futuras en el cronograma")
            target_week = min(fut_weeks)
        items.append(
            CellBulkItem(
                wbs_id=data.wbs_id,
                week_start=target_week,
                planned_amount=data.suggested_amount,
                state_id=state_id,
            )
        )
        desc = (
            f"Monto de #{data.wbs_id} fijado en {target_week.strftime('%Y-%m')} = "
            f"{_fmt(data.suggested_amount or Decimal(0))}."
        )

    n = sched_service.upsert_cells_bulk(db, items)
    return {"ok": True, "cells_changed": n, "description": desc}


# ---- Paquetes de aprobación (foto congelada por mes) -----------------------


def _window(period_from: str, months: int) -> list[str]:
    y, m = int(period_from[:4]), int(period_from[5:7])
    out = []
    for i in range(months):
        mm = m + i
        out.append(f"{y + (mm - 1) // 12:04d}-{(mm - 1) % 12 + 1:02d}")
    return out


def build_snapshot(db: Session, period_from: str, months: int) -> dict[str, Any]:
    """Foto congelada: por número de proyecto (con presupuesto o con plan en la
    ventana), los montos planeados de esos meses + presupuesto/gasto/remanente."""
    win = _window(period_from, months)
    cells = (
        db.execute(text("SELECT wbs_id, week_start, planned_amount FROM schedule_cell"))
        .mappings()
        .all()
    )
    planned: dict[int, dict[str, float]] = {}
    for c in cells:
        ym = str(c["week_start"])[:7]
        if ym in win and c["planned_amount"] is not None:
            planned.setdefault(c["wbs_id"], {})
            planned[c["wbs_id"]][ym] = planned[c["wbs_id"]].get(ym, 0.0) + float(c["planned_amount"])
    proj = db.execute(text("SELECT project_name FROM settings LIMIT 1")).scalar()
    rows = []
    for w in wbs_repo.financials(db):
        if w.get("kind") in ("section_header", "proceeds"):
            continue
        rev = float(w.get("budget_revised") or 0)
        pl = planned.get(w["id"], {})
        if rev <= 0 and abs(sum(pl.values())) < 0.005:
            continue
        rows.append(
            {
                "wbs_id": w["id"],
                "wbs_code": w["wbs_code"],
                "title": w.get("title"),
                "category": w.get("category"),
                "phase": w.get("phase"),
                "budget_revised": str(w.get("budget_revised") or 0),
                "spend": str(w.get("spend") or 0),
                "remaining": str(w.get("remaining") or 0),
                "planned": {ym: pl.get(ym, 0.0) for ym in win},
            }
        )
    return {"project_name": proj, "months": win, "rows": rows}


class PackageIn(BaseModel):
    name: str
    period_from: str
    months: int = 3


@router.get("/packages", dependencies=[_can_view])
def list_packages(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = (
        db.execute(
            text(
                "SELECT p.id, p.name, p.period_from, p.months, p.token, p.status, p.comments, "
                "       p.created_at, p.opened_count, p.opened_at, p.last_opened_at, "
                "       (SELECT count(*) FROM planning_package_submission s "
                "        WHERE s.package_id = p.id) AS submission_count "
                "FROM planning_package p ORDER BY p.created_at DESC"
            )
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


@router.get("/packages/{pid}/submissions", dependencies=[_can_view])
def list_submissions(pid: int, db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = (
        db.execute(
            text(
                "SELECT id, reviewer_name, comments, notes, submitted_at "
                "FROM planning_package_submission WHERE package_id = :p ORDER BY submitted_at DESC"
            ),
            {"p": pid},
        )
        .mappings()
        .all()
    )
    return [dict(r) for r in rows]


@router.delete("/packages/{pid}/submissions/{sid}", dependencies=[_can_edit])
def delete_submission(pid: int, sid: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    r = db.execute(
        text(
            "DELETE FROM planning_package_submission WHERE id = :s AND package_id = :p RETURNING id"
        ),
        {"s": sid, "p": pid},
    ).first()
    if r is None:
        raise Problem(status_code=404, title="Versión no encontrada")
    return {"ok": True}


@router.post("/packages", dependencies=[_can_edit])
def create_package(data: PackageIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    snap = build_snapshot(db, data.period_from, data.months)
    token = secrets.token_hex(16)
    pid = db.execute(
        text(
            "INSERT INTO planning_package (name, period_from, months, token, snapshot) "
            "VALUES (:n, :pf, :mo, :tok, cast(:snap AS jsonb)) RETURNING id"
        ),
        {"n": data.name, "pf": data.period_from, "mo": data.months, "tok": token,
         "snap": json.dumps(snap)},
    ).scalar()
    return {"id": pid, "token": token}


@router.delete("/packages/{pid}", dependencies=[_can_edit])
def delete_package(pid: int, db: Session = Depends(get_db)) -> dict[str, Any]:
    r = db.execute(
        text("DELETE FROM planning_package WHERE id = :i RETURNING id"), {"i": pid}
    ).first()
    if r is None:
        raise Problem(status_code=404, title="Paquete no encontrado")
    return {"ok": True}
