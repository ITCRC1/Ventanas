"""Autenticación: OIDC Microsoft 365 + login de desarrollo + sesión JWT."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.oidc import extract_email, get_oauth
from app.core.problems import Problem
from app.core.security import (
    clear_session_cookie,
    issue_session_token,
    set_session_cookie,
    verify_password,
)
from app.deps import CurrentUser, get_current_user, get_db, get_settings_dep
from app.models.access import AppUser
from app.schemas.auth import AuthConfig, DevLoginIn, PasswordLoginIn, SharedLoginIn, UserOut
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _login_user(response: Response, settings: Settings, db: Session, user: AppUser) -> UserOut:
    role_code = user.role.code if user.role else ""
    token = issue_session_token(
        settings, user_id=user.id, username=user.username, role=role_code, role_id=user.role_id
    )
    set_session_cookie(response, settings, token)
    return auth_service.user_out(db, user)


@router.get("/config", response_model=AuthConfig)
def auth_config(settings: Settings = Depends(get_settings_dep)) -> AuthConfig:
    """Modos de acceso disponibles, para que la pantalla de login se adapte."""
    return AuthConfig(
        dev_login=settings.dev_login_enabled and not settings.is_prod,
        shared_gate=bool(settings.shared_password),
        oidc=settings.oidc_enabled,
        password_login=True,
    )


@router.post("/login", response_model=UserOut)
def password_login(
    data: PasswordLoginIn,
    response: Response,
    settings: Settings = Depends(get_settings_dep),
    db: Session = Depends(get_db),
) -> UserOut:
    """Login por correo + contraseña. El usuario debe existir, estar activo y
    tener credencial en user_credential."""
    from sqlalchemy import text

    email = data.email.strip().lower()
    row = db.execute(
        text(
            "SELECT u.id, c.password_hash FROM app_user u "
            "JOIN user_credential c ON c.user_id = u.id "
            "WHERE lower(u.email) = :e AND u.is_active"
        ),
        {"e": email},
    ).first()
    if row is None or not verify_password(data.password, row[1]):
        raise Problem(
            status_code=401,
            title="Credenciales incorrectas",
            detail="Correo o contraseña inválidos.",
        )
    user = db.get(AppUser, row[0])
    return _login_user(response, settings, db, user)


@router.post("/shared-login", response_model=UserOut)
def shared_login(
    data: SharedLoginIn,
    response: Response,
    settings: Settings = Depends(get_settings_dep),
    db: Session = Depends(get_db),
) -> UserOut:
    """Portón de contraseña compartida: entra como shared_login_user."""
    if not settings.shared_password:
        raise Problem(status_code=404, title="No disponible")
    if data.password != settings.shared_password:
        raise Problem(status_code=401, title="Clave incorrecta", detail="La clave no coincide.")
    user = auth_service.authenticate_dev(db, settings.shared_login_user)
    return _login_user(response, settings, db, user)


@router.post("/dev-login", response_model=UserOut)
def dev_login(
    data: DevLoginIn,
    response: Response,
    settings: Settings = Depends(get_settings_dep),
    db: Session = Depends(get_db),
) -> UserOut:
    """Login sin Azure para desarrollo local. Deshabilitado en prod."""
    if settings.is_prod or not settings.dev_login_enabled:
        raise Problem(status_code=404, title="No disponible")
    user = auth_service.authenticate_dev(db, data.username)
    return _login_user(response, settings, db, user)


@router.get("/login")
async def oidc_login(
    request: Request, settings: Settings = Depends(get_settings_dep)
) -> RedirectResponse:
    if not settings.oidc_enabled:
        raise Problem(
            status_code=503,
            title="OIDC no configurado",
            detail="El acceso con Microsoft 365 aún no está habilitado.",
        )
    oauth = get_oauth(settings)
    redirect: RedirectResponse = await oauth.microsoft.authorize_redirect(
        request, settings.oidc_redirect_uri
    )
    return redirect


@router.get("/callback")
async def oidc_callback(
    request: Request,
    settings: Settings = Depends(get_settings_dep),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    if not settings.oidc_enabled:
        raise Problem(status_code=503, title="OIDC no configurado")
    oauth = get_oauth(settings)
    token = await oauth.microsoft.authorize_access_token(request)
    userinfo = token.get("userinfo") or {}
    email = extract_email(userinfo)
    if not email:
        raise Problem(status_code=400, title="Sin email", detail="Azure no devolvió un email.")
    user = auth_service.authenticate_by_email(db, email)
    response = RedirectResponse(url=settings.web_url)
    _login_user(response, settings, db, user)
    return response


@router.post("/logout")
def logout(response: Response, settings: Settings = Depends(get_settings_dep)) -> dict[str, str]:
    clear_session_cookie(response, settings)
    return {"message": "Sesión cerrada"}


@router.get("/me", response_model=UserOut)
def me(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserOut:
    db_user = auth_service.authenticate_dev(db, user.username)
    return auth_service.user_out(db, db_user)
