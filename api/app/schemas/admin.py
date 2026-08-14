"""Schemas del panel de administración (perfiles y usuarios)."""

from __future__ import annotations

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


class UserIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=160)
    role_id: int
    password: str | None = Field(default=None, min_length=6, max_length=128)


class UserUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    role_id: int | None = None
    is_active: bool | None = None


class PasswordIn(BaseModel):
    password: str = Field(min_length=6, max_length=128)
