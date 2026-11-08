"""Schemas del panel de administración (perfiles y usuarios)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class PermissionOut(BaseModel):
    code: str
    description: str
    group: str  # "view" | "action" | "admin"


class RoleOut(BaseModel):
    id: int
    code: str
    name: str
    permissions: list[str]
    user_count: int


class RoleIn(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=1, max_length=80)


class RoleUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class RolePermsIn(BaseModel):
    permissions: list[str]


class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    email: str | None
    role_id: int
    role: str
    is_active: bool
    has_password: bool
    last_login: datetime | None = None
    # Hay un link vivo sin abrir: la persona todavia no entro.
    invite_pending: bool = False
    # Solo viene en el alta y al reinvitar; nunca en el listado.
    invite_token: str | None = None
    invite_days: int | None = None


class UserIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=160)
    role_id: int
    # ⚠️ Ya NO lleva `password`. El administrador no elige ni ve la clave: el
    # alta devuelve un link de invitacion y la persona pone la suya.


class UserUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    role_id: int | None = None
    is_active: bool | None = None


class InviteOut(BaseModel):
    """Lo que se le muestra al administrador, UNA sola vez."""

    invite_token: str
    invite_days: int
