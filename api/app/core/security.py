"""Sesión JWT en cookie httponly (§2 DECISIONES).

La cookie es httponly + secure (prod) + samesite=lax, con expiración de 8 h.
No guardamos contraseñas: la identidad viene de OIDC (o del login de desarrollo).
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt
from fastapi import Response

from app.core.config import Settings

# --- Contraseñas (login correo+clave; hash bcrypt, nunca en claro) -----------


def hash_password(password: str) -> str:
    # bcrypt topa a 72 bytes; se trunca de forma segura (estándar).
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# --- Invitaciones (la clave la pone el dueno de la cuenta) -------------------
#
# ⚠️ El token se guarda HASHEADO, igual que una contrasena. Si alguien lee
# `user_invite` no puede entrar con lo que encuentra: necesita el token en
# claro, que solo existe una vez, en la respuesta que ve el administrador.
#
# sha256 y no bcrypt a proposito: el token son 32 bytes aleatorios, no una
# clave que alguien pueda adivinar, asi que no hace falta un hash lento —y si
# lo fuera, validar la invitacion costaria lo mismo que un login.

INVITE_DAYS = 7


def nueva_invitacion() -> tuple[str, str]:
    """Devuelve (token en claro, hash para guardar). El claro no se vuelve a ver."""
    token = secrets.token_urlsafe(32)
    return token, hash_invite_token(token)


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class PasswordDebil(ValueError):
    """La clave no cumple la politica."""


def validar_password(password: str) -> str:
    """Minimo 10, con letras y numeros — la misma regla del proyecto de referencia.

    Antes el minimo eran 6 caracteres sin ninguna otra condicion. Se valida en
    el servidor y no solo en la pantalla: la pantalla se puede saltar.
    """
    p = (password or "").strip()
    if len(p) < 10:
        raise PasswordDebil("La contrasena necesita al menos 10 caracteres.")
    if not any(c.isalpha() for c in p) or not any(c.isdigit() for c in p):
        raise PasswordDebil("La contrasena necesita letras y numeros.")
    return p


def issue_session_token(
    settings: Settings, *, user_id: int, username: str, role: str, role_id: int
) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "role_id": role_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=settings.session_hours)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_session_token(settings: Settings, token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def set_session_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        max_age=settings.session_hours * 3600,
        path="/",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(key=settings.cookie_name, path="/")
