"""Schemas del cronograma."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class CellOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    wbs_id: int
    week_start: date
    planned_amount: Decimal | None
    state_id: int
    note: str | None


class CellIn(BaseModel):
    """Upsert de una celda. La base valida lunes + estado-exige-monto."""

    wbs_id: int
    week_start: date
    planned_amount: Decimal | None = None
    state_id: int
    note: str | None = None


class CellBulkItem(BaseModel):
    """Una celda en un lote (pegar/rellenar). state_id opcional: si no viene se
    conserva el estado existente o se usa el primero. planned_amount None = borrar."""

    wbs_id: int
    week_start: date
    planned_amount: Decimal | None = None
    state_id: int | None = None
    note: str | None = None


class CellsBulkIn(BaseModel):
    cells: list[CellBulkItem]


class WeeksOut(BaseModel):
    start: date | None
    end: date | None
    weeks: list[date]
