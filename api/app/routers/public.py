"""Endpoints PÚBLICOS del Planning (SIN login) — link para aprobación.

Gated por un token en la URL (settings.planning_share_token). Solo Planning:
ver + comentar (notas por proyecto + comentario general). No expone el resto
de la app. NO lleva get_current_user a propósito.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.problems import Problem
from app.deps import get_db
from app.repositories import schedule as sched_repo
from app.repositories import wbs as wbs_repo

router = APIRouter(prefix="/public", tags=["public"])


def _check(db: Session, token: str) -> None:
    real = db.execute(text("SELECT planning_share_token FROM settings LIMIT 1")).scalar()
    if not real or token != real:
        raise Problem(status_code=404, title="Enlace no válido o vencido")


class NoteIn(BaseModel):
    wbs_id: int
    note: str | None = None
    suggested_amount: Decimal | None = None
    move_to_month: str | None = None


class CommentsIn(BaseModel):
    comments: str | None = None


@router.get("/planning/{token}")
def public_planning(token: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    _check(db, token)
    s = (
        db.execute(
            text("SELECT project_name, cutoff_date, planning_comments FROM settings LIMIT 1")
        )
        .mappings()
        .first()
    )
    start, end = sched_repo.week_bounds(db)
    weeks = [w.isoformat() for w in sched_repo.contiguous_weeks(start, end)]
    cells = (
        db.execute(text("SELECT wbs_id, week_start, planned_amount, state_id FROM schedule_cell"))
        .mappings()
        .all()
    )
    notes = (
        db.execute(
            text("SELECT wbs_id, note, suggested_amount, move_to_month FROM planning_note")
        )
        .mappings()
        .all()
    )
    return {
        "project_name": s["project_name"] if s else None,
        "cutoff_date": s["cutoff_date"] if s else None,
        "comments": s["planning_comments"] if s else None,
        "weeks": weeks,
        "financials": wbs_repo.financials(db),
        "cells": [dict(c) for c in cells],
        "notes": [dict(n) for n in notes],
    }


@router.put("/planning/{token}/note")
def public_note(token: str, data: NoteIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    _check(db, token)
    db.execute(
        text(
            """
            INSERT INTO planning_note (wbs_id, note, suggested_amount, move_to_month, updated_at,
                                       updated_by)
            VALUES (:w, :n, :a, :m, now(), 'shared-link')
            ON CONFLICT (wbs_id) DO UPDATE SET
              note = :n, suggested_amount = :a, move_to_month = :m,
              updated_at = now(), updated_by = 'shared-link'
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


@router.put("/planning/{token}/comments")
def public_comments(token: str, data: CommentsIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    _check(db, token)
    db.execute(text("UPDATE settings SET planning_comments = :c"), {"c": data.comments or None})
    return {"ok": True}


class SubmitIn(BaseModel):
    reviewer_name: str | None = None


@router.post("/planning/{token}/open")
def public_planning_open(token: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Read receipt del LINK NORMAL: registra que el aprobador lo abrió."""
    _check(db, token)
    db.execute(
        text(
            "UPDATE settings SET planning_opened_count = planning_opened_count + 1, "
            "planning_opened_at = COALESCE(planning_opened_at, now()), "
            "planning_last_opened_at = now()"
        )
    )
    return {"ok": True}


@router.post("/planning/{token}/submit")
def public_planning_submit(
    token: str, data: SubmitIn, db: Session = Depends(get_db)
) -> dict[str, Any]:
    """"Send with comments" del LINK NORMAL: guarda una versión devuelta
    (comentario general + notas por proyecto) que le queda al owner hasta borrarla."""
    _check(db, token)
    comments = db.execute(text("SELECT planning_comments FROM settings LIMIT 1")).scalar()
    notes = (
        db.execute(
            text(
                "SELECT wbs_id, note, suggested_amount::text AS suggested_amount, move_to_month "
                "FROM planning_note"
            )
        )
        .mappings()
        .all()
    )
    db.execute(
        text(
            "INSERT INTO planning_link_submission (reviewer_name, comments, notes) "
            "VALUES (:r, :c, cast(:n AS jsonb))"
        ),
        {
            "r": (data.reviewer_name or None),
            "c": comments,
            "n": json.dumps([dict(x) for x in notes]),
        },
    )
    return {"ok": True}


# ---- Paquetes de aprobación (foto congelada) — público por token -----------


@router.get("/package/{token}")
def public_package(token: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    pkg = (
        db.execute(
            text(
                "SELECT id, name, period_from, months, comments, status, snapshot "
                "FROM planning_package WHERE token = :t"
            ),
            {"t": token},
        )
        .mappings()
        .first()
    )
    if pkg is None:
        raise Problem(status_code=404, title="Enlace no válido o vencido")
    notes = (
        db.execute(
            text(
                "SELECT wbs_id, note, suggested_amount, move_to_month "
                "FROM planning_package_note WHERE package_id = :p"
            ),
            {"p": pkg["id"]},
        )
        .mappings()
        .all()
    )
    return {
        "name": pkg["name"],
        "period_from": pkg["period_from"],
        "months": pkg["months"],
        "comments": pkg["comments"],
        "status": pkg["status"],
        "snapshot": pkg["snapshot"],
        "notes": [dict(n) for n in notes],
    }


@router.put("/package/{token}/note")
def public_package_note(token: str, data: NoteIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    pid = db.execute(
        text("SELECT id FROM planning_package WHERE token = :t"), {"t": token}
    ).scalar()
    if pid is None:
        raise Problem(status_code=404, title="Enlace no válido o vencido")
    db.execute(
        text(
            """
            INSERT INTO planning_package_note
              (package_id, wbs_id, note, suggested_amount, move_to_month, updated_at, updated_by)
            VALUES (:p, :w, :n, :a, :m, now(), 'shared-link')
            ON CONFLICT (package_id, wbs_id) DO UPDATE SET
              note = :n, suggested_amount = :a, move_to_month = :m,
              updated_at = now(), updated_by = 'shared-link'
            """
        ),
        {
            "p": pid,
            "w": data.wbs_id,
            "n": (data.note or None),
            "a": data.suggested_amount,
            "m": (data.move_to_month or None),
        },
    )
    return {"ok": True}


@router.put("/package/{token}/comments")
def public_package_comments(
    token: str, data: CommentsIn, db: Session = Depends(get_db)
) -> dict[str, Any]:
    r = db.execute(
        text("UPDATE planning_package SET comments = :c WHERE token = :t RETURNING id"),
        {"c": (data.comments or None), "t": token},
    ).first()
    if r is None:
        raise Problem(status_code=404, title="Enlace no válido o vencido")
    return {"ok": True}


@router.post("/package/{token}/open")
def public_package_open(token: str, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Read receipt: registra que el aprobador abrió el link (1 por carga)."""
    r = db.execute(
        text(
            "UPDATE planning_package SET opened_count = opened_count + 1, "
            "opened_at = COALESCE(opened_at, now()), last_opened_at = now() "
            "WHERE token = :t RETURNING id"
        ),
        {"t": token},
    ).first()
    if r is None:
        raise Problem(status_code=404, title="Enlace no válido o vencido")
    return {"ok": True}


class SubmitIn(BaseModel):
    reviewer_name: str | None = None


@router.post("/package/{token}/submit")
def public_package_submit(
    token: str, data: SubmitIn, db: Session = Depends(get_db)
) -> dict[str, Any]:
    """"Send with comments": guarda una VERSIÓN devuelta (snapshot de comentarios +
    notas actuales) que le queda al owner hasta que la borre."""
    pkg = (
        db.execute(
            text("SELECT id, comments FROM planning_package WHERE token = :t"), {"t": token}
        )
        .mappings()
        .first()
    )
    if pkg is None:
        raise Problem(status_code=404, title="Enlace no válido o vencido")
    notes = (
        db.execute(
            text(
                "SELECT wbs_id, note, suggested_amount::text AS suggested_amount, move_to_month "
                "FROM planning_package_note WHERE package_id = :p"
            ),
            {"p": pkg["id"]},
        )
        .mappings()
        .all()
    )
    db.execute(
        text(
            "INSERT INTO planning_package_submission (package_id, reviewer_name, comments, notes) "
            "VALUES (:p, :r, :c, cast(:n AS jsonb))"
        ),
        {
            "p": pkg["id"],
            "r": (data.reviewer_name or None),
            "c": pkg["comments"],
            "n": json.dumps([dict(x) for x in notes]),
        },
    )
    return {"ok": True}
