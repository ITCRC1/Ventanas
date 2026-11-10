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


def require_any_permission(*codes: str) -> Callable[..., CurrentUser]:
    """Exige AL MENOS UNO de `codes`.

    Owner, 2026-11-10: *«si, quiero esconder pantallas»* — o sea que la API
    tambien cierre, no solo el menu.

    ⚠️ Hace falta «alguno de» y no «este»: **la mayoria de los endpoints los
    comparten varias pantallas**. Medido sobre el codigo, `/wbs/financials` lo
    piden OCHO pantallas y `/schedule/cells` siete. Exigir el permiso de una
    sola le rompe la pantalla a quien tiene las otras — y el 403 aparece como
    una tabla vacia, que es la forma mas cara de romper algo: parece un dato,
    no un error.

    Por eso cada router pide la union de los permisos de las pantallas que de
    verdad lo usan, y los catalogos compartidos (`/wbs`, `/schedule`,
    `/categories`, `/phases`, `/payees`) no piden ninguno: no son una pantalla,
    y cerrarlos esconde cero sin romper de a varias.
    """

    def _dependency(
        user: CurrentUser = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> CurrentUser:
        if not set(codes) & user_permissions(db, user.role_id):
            raise Problem(
                status_code=403,
                title="Permiso denegado",
                detail="Su rol no tiene ninguno de los permisos: "
                + ", ".join(f"«{c}»" for c in codes),
            )
        return user

    return _dependency
