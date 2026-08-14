"""Lógica del cronograma. Las reglas duras (lunes, estado-exige-monto) son de la
base; aquí sólo hacemos el upsert y traducimos errores."""

from __future__ import annotations

from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.schedule import ScheduleCell
from app.repositories import schedule as repo
from app.schemas.schedule import CellBulkItem, CellIn


def _default_state_id(db: Session) -> int:
    return int(
        db.execute(text("SELECT id FROM task_state ORDER BY sort_order, id LIMIT 1")).scalar() or 1
    )


def upsert_cells_bulk(db: Session, items: list[CellBulkItem]) -> int:
    """Lote de celdas (pegar/rellenar/borrar). planned_amount None => borra la
    celda. state_id None => conserva el existente o usa el primero. Un solo commit
    (lo hace get_db). Dispara los mismos triggers de la BD por celda."""
    default_state: int | None = None
    n = 0
    for it in items:
        if it.planned_amount is None:
            db.execute(
                text("DELETE FROM schedule_cell WHERE wbs_id = :w AND week_start = :d"),
                {"w": it.wbs_id, "d": it.week_start},
            )
            n += 1
            continue
        cell = repo.get_cell(db, it.wbs_id, it.week_start)
        st = it.state_id
        if st is None:
            if cell is not None:
                st = cell.state_id
            else:
                if default_state is None:
                    default_state = _default_state_id(db)
                st = default_state
        if cell is None:
            cell = ScheduleCell(
                wbs_id=it.wbs_id, week_start=it.week_start,
                planned_amount=it.planned_amount, state_id=st, note=it.note,
            )
            db.add(cell)
        else:
            cell.planned_amount = it.planned_amount
            cell.state_id = st
            if it.note is not None:
                cell.note = it.note
        n += 1
    db.flush()
    return n


def upsert_cell(db: Session, data: CellIn) -> ScheduleCell:
    """Crea o actualiza la celda (wbs_id, week_start). Dispara los triggers."""
    cell = repo.get_cell(db, data.wbs_id, data.week_start)
    if cell is None:
        cell = ScheduleCell(**data.model_dump())
        db.add(cell)
    else:
        cell.planned_amount = data.planned_amount
        cell.state_id = data.state_id
        cell.note = data.note
    db.flush()
    db.refresh(cell)
    return cell


def clear_cell(db: Session, wbs_id: int, week_start: date) -> None:
    """Borra la celda (limpiar una semana). No es dato financiero: la celda es
    una materialización transitoria del plan, se borra físicamente."""
    db.execute(
        text("DELETE FROM schedule_cell WHERE wbs_id = :w AND week_start = :d"),
        {"w": wbs_id, "d": week_start},
    )
