"""Schemas transversales."""

from __future__ import annotations

from pydantic import BaseModel, Field


class Page(BaseModel):
    """Paginación limit/offset con tope de 500 (§6 DECISIONES)."""

    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


class Message(BaseModel):
    message: str
