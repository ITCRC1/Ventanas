"""Schemas de catálogos: categoría, fase, estado, tipo de línea."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    color_hex: str | None
    sort_order: int
    is_active: bool


class CategoryIn(BaseModel):
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    color_hex: str | None = None
    sort_order: int = 0
    is_active: bool = True


class CategoryUpdate(BaseModel):
    name: str | None = None
    color_hex: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class PhaseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category_id: int
    code: str
    name: str
    sort_order: int


class PhaseIn(BaseModel):
    category_id: int
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    sort_order: int = 0


class PhaseUpdate(BaseModel):
    name: str | None = None
    sort_order: int | None = None


class TaskStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    label: str
    color_hex: str
    requires_amount: bool
    is_committed: bool
    sort_order: int


class LineTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    label: str
    counts_as_cost: bool


class ProjectMetaOut(BaseModel):
    """Metadata de cabecera del Job Cost (hoja: Project Title / PM / Company / UPDATED)."""

    project_name: str | None
    company: str | None
    manager: str | None
    report_currency: str | None
    cutoff_date: date | None
    horizon_start: date | None
    horizon_end: date | None
    updated_at: datetime | None
