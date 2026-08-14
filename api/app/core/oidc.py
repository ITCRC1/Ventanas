"""Cliente OIDC contra Microsoft 365 (authlib).

Nunca manejamos contraseñas propias: el usuario se autentica contra Azure AD y
volvemos con su email, que mapeamos a un app_user existente. Si el email no
corresponde a un usuario activo, se rechaza el acceso.

El registro de la aplicación en Azure (client id/secret, redirect URI) lo hace
el dueño del tenant — es infraestructura externa (DECISIONES §9.4). Mientras no
esté configurado, oidc_enabled=false y se usa el login de desarrollo.
"""

from __future__ import annotations

from typing import Any

from authlib.integrations.starlette_client import OAuth

from app.core.config import Settings

_oauth: OAuth | None = None


def get_oauth(settings: Settings) -> OAuth:
    global _oauth
    if _oauth is None:
        oauth = OAuth()
        oauth.register(
            name="microsoft",
            client_id=settings.oidc_client_id,
            client_secret=settings.oidc_client_secret,
            server_metadata_url=settings.oidc_metadata_url,
            client_kwargs={"scope": "openid email profile"},
        )
        _oauth = oauth
    return _oauth


def extract_email(userinfo: dict[str, Any]) -> str | None:
    """Azure devuelve el email en 'email' o, a veces, en 'preferred_username'."""
    email = userinfo.get("email") or userinfo.get("preferred_username")
    return email.lower().strip() if isinstance(email, str) else None
