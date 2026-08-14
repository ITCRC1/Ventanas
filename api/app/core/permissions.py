"""Permisos leídos de role_permission (§2 DECISIONES: sin permisos en código).

require_permission() es una dependencia de FastAPI que consulta la tabla
role_permission del usuario autenticado. bank.view y disb.approve son permisos
SEPARADOS a propósito.
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.problems import Problem
from app.deps import CurrentUser, get_current_user, get_db


def user_permissions(db: Session, role_id: int) -> set[str]:
    rows = db.execute(
        text("SELECT permission FROM role_permission WHERE role_id = :rid"),
        {"rid": role_id},
    ).scalars()
    return set(rows)


def require_permission(code: str) -> Callable[..., CurrentUser]:
    """Devuelve una dependencia que exige el permiso `code`."""

    def _dependency(
        user: CurrentUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> CurrentUser:
        if code not in user_permissions(db, user.role_id):
            raise Problem(
                status_code=403,
                title="Permiso denegado",
                detail=f"Su rol no tiene el permiso «{code}».",
            )
        return user

    return _dependency
