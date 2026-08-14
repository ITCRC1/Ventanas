"""Motor y sesión SQLAlchemy 2.0 (sync, psycopg3).

Una transacción por request (§6 DECISIONES). El usuario de auditoría se fija
con SELECT set_config('app.user_id', ...) al abrir la transacción — NUNCA con
SET, que no acepta parámetros (trampa conocida del proyecto).
"""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings

_settings = get_settings()

engine = create_engine(
    _settings.database_url,
    pool_pre_ping=True,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


class Base(DeclarativeBase):
    """Base declarativa de todos los modelos ORM."""


def set_audit_user(session: Session, user_id: str | None) -> None:
    """Fija app.user_id para que los triggers de auditoría registren el autor.

    Usa set_config con parámetro ligado (SET app.user_id = %s falla en Postgres).
    """
    session.execute(
        text("SELECT set_config('app.user_id', :uid, false)"),
        {"uid": user_id or ""},
    )


def session_scope(user_id: str | None = None) -> Iterator[Session]:
    """Contexto transaccional: commit al salir bien, rollback si algo falla."""
    session = SessionLocal()
    try:
        set_audit_user(session, user_id)
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
