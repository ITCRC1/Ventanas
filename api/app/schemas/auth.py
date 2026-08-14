"""Schemas de autenticación."""

from __future__ import annotations

from pydantic import BaseModel


class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    email: str | None
    role: str
    role_id: int
    permissions: list[str]


class DevLoginIn(BaseModel):
    """Login de desarrollo: sólo username, sin contraseña. Habilitado solo en dev."""

    username: str


class SharedLoginIn(BaseModel):
    """Portón de contraseña compartida (demo/URL pública)."""

    password: str


class PasswordLoginIn(BaseModel):
    """Login por correo + contraseña (usuarios con perfil asignado)."""

    email: str
    password: str


class AuthConfig(BaseModel):
    """Qué modos de acceso ofrece el servidor (para que el login se adapte)."""

    dev_login: bool
    shared_gate: bool
    oidc: bool
    password_login: bool = True
