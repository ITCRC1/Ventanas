"""Lógica de autenticación: mapear identidad externa a un app_user."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.permissions import user_permissions
from app.core.problems import Problem
from app.models.access import AppUser, Role
from app.schemas.auth import UserOut


def _load_active_user(
    db: Session, *, email: str | None = None, username: str | None = None
) -> AppUser:
    stmt = select(AppUser)
    if email is not None:
        stmt = stmt.where(AppUser.email == email)
    elif username is not None:
        stmt = stmt.where(AppUser.username == username)
    else:
        raise Problem(status_code=400, title="Falta identificador de usuario")
    user = db.execute(stmt).scalar_one_or_none()
    if user is None or not user.is_active:
        raise Problem(
            status_code=403,
            title="Acceso denegado",
            detail="El usuario no existe o está inactivo.",
        )
    return user


def authenticate_by_email(db: Session, email: str) -> AppUser:
    """Login OIDC: el email de Azure AD tiene que corresponder a un usuario activo."""
    return _load_active_user(db, email=email)


def authenticate_dev(db: Session, username: str) -> AppUser:
    """Login de desarrollo por username, sin contraseña. Solo en env=dev."""
    return _load_active_user(db, username=username)


def user_out(db: Session, user: AppUser) -> UserOut:
    role = db.get(Role, user.role_id)
    return UserOut(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        email=user.email,
        role=role.code if role else "",
        role_id=user.role_id,
        permissions=sorted(user_permissions(db, user.role_id)),
    )
