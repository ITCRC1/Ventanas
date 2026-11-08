"""Schemas de autenticación."""

from __future__ import annotations

from pydantic import BaseModel, Field


class UserOut(BaseModel):
    id: int
    username: str
    full_name: str
    email: str | None
    role: str
    role_id: int
    permissions: list[str]
    # ⚠️ La columna existia desde la 0043 y nadie la leia. Ahora la pantalla la
    # usa para mandar a /cuenta antes de dejar entrar.
    must_change: bool = False


class CambioPasswordIn(BaseModel):
    """El propio usuario cambia su clave. Hasta hoy no se podia."""

    current: str = Field(min_length=1, max_length=128)
    new: str = Field(min_length=1, max_length=128)


class InviteIn(BaseModel):
    """Abrir o consumir una invitacion.

    Sin `password` solo pregunta de quien es el link (para saludar a la persona
    por su nombre); con `password` la consume y deja la sesion abierta.
    """

    token: str = Field(min_length=10, max_length=200)
    password: str | None = Field(default=None, max_length=128)


class InviteOut(BaseModel):
    full_name: str
    email: str | None


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
