"""Salud del servicio."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.deps import get_db

router = APIRouter(tags=["salud"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/db")
def health_db(db: Session = Depends(get_db)) -> dict[str, object]:
    tables = db.execute(
        text("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
    ).scalar_one()
    return {"status": "ok", "public_tables": tables}
