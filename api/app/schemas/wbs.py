"""Schemas del WBS."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class WbsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    wbs_code: str
    parent_id: int | None
    title: str
    owner: str | None
    category_id: int | None
    phase_id: int | None
    state_id: int
    kind: str
    sort_order: int
    is_active: bool
    start_date: date | None = None
    due_date: date | None = None


class WbsIn(BaseModel):
    wbs_code: str = Field(min_length=1)
    title: str = Field(min_length=1)
    parent_id: int | None = None
    owner: str | None = None
    category_id: int | None = None
    phase_id: int | None = None
    state_id: int = 1
    kind: str = "cost"
    sort_order: int = 0
    # Presupuesto de arranque: al crear la línea desde Job Cost, el owner puede
    # fijar el Original (y opcionalmente el Change). La vista v_wbs_financials
    # ya hace COALESCE(w.budget_original_ovr, …) → aparece sin tocar budget_line.
    budget_original_ovr: Decimal | None = None
    budget_change_ovr: Decimal | None = None


class WbsUpdate(BaseModel):
    title: str | None = None
    owner: str | None = None
    category_id: int | None = None
    phase_id: int | None = None
    state_id: int | None = None
    kind: str | None = None
    forecast_total: Decimal | None = None
    budget_original_ovr: Decimal | None = None
    budget_change_ovr: Decimal | None = None
    spend_ovr: Decimal | None = None
    start_date: date | None = None
    due_date: date | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class WbsReassign(BaseModel):
    """Reasignar categoría/fase. El trigger del esquema valida la coherencia."""

    category_id: int | None = None
    phase_id: int | None = None


class WbsFinancialsOut(BaseModel):
    """Fila de v_wbs_financials (SQL crudo, solo lectura)."""

    id: int
    wbs_code: str
    title: str
    owner: str | None
    kind: str
    state: str
    category: str | None
    phase: str | None
    budget_original: Decimal
    budget_change: Decimal
    budget_revised: Decimal
    spend: Decimal
    remaining: Decimal
    forecast: Decimal
    over_under: Decimal
    draw_no: int | None
    start_date: date | None
    due_date: date | None
    duration_days: int | None
    draw_no_first: int | None
