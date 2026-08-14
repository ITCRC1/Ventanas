"""Dependencias de FastAPI: sesión de BD por request y usuario autenticado."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

import jwt
from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.db import SessionLocal, set_audit_user
from app.core.problems import Problem
from app.core.security import decode_session_token


@dataclass(frozen=True)
class CurrentUser:
    id: int
    username: str
    role: str
    role_id: int


def get_settings_dep() -> Settings:
    return get_settings()


def _current_user_from_request(request: Request, settings: Settings) -> CurrentUser | None:
    token = request.cookies.get(settings.cookie_name)
    if not token:
        return None
    try:
        payload = decode_session_token(settings, token)
    except jwt.PyJWTError:
        return None
    try:
        return CurrentUser(
            id=int(payload["sub"]),
            username=payload["username"],
            role=payload["role"],
            role_id=int(payload["role_id"]),
        )
    except (KeyError, ValueError):
        return None


def get_db(
    request: Request,
    settings: Settings = Depends(get_settings_dep),
) -> Iterator[Session]:
    """Una transacción por request. Fija app.user_id para la auditoría.

    Commit al terminar bien; rollback ante cualquier excepción.
    """
    user = _current_user_from_request(request, settings)
    session = SessionLocal()
    try:
        set_audit_user(session, str(user.id) if user else None)
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_current_user(
    request: Request,
    settings: Settings = Depends(get_settings_dep),
) -> CurrentUser:
    user = _current_user_from_request(request, settings)
    if user is None:
        raise Problem(status_code=401, title="No autenticado", detail="Inicie sesión.")
    return user


def get_optional_user(
    request: Request,
    settings: Settings = Depends(get_settings_dep),
) -> CurrentUser | None:
    return _current_user_from_request(request, settings)
