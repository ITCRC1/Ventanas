"""Autenticación: OIDC Microsoft 365 + login de desarrollo + sesión JWT."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.oidc import extract_email, get_oauth
from app.core.problems import Problem
from app.core.security import (
    PasswordDebil,
    clear_session_cookie,
    hash_invite_token,
    hash_password,
    issue_session_token,
    set_session_cookie,
    validar_password,
    verify_password,
)
from app.deps import CurrentUser, get_current_user, get_db, get_settings_dep
from app.models.access import AppUser
from app.schemas.auth import (
    AuthConfig,
    CambioPasswordIn,
    DevLoginIn,
    InviteIn,
    InviteOut,
    PasswordLoginIn,
    SharedLoginIn,
    UserOut,
)
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _login_user(response: Response, settings: Settings, db: Session, user: AppUser) -> UserOut:
    role_code = user.role.code if user.role else ""
    token = issue_session_token(
        settings, user_id=user.id, username=user.username, role=role_code, role_id=user.role_id
    )
    set_session_cookie(response, settings, token)
    # Quien entro y cuando. La pantalla de administracion lo muestra para
    # distinguir al que nunca abrio su invitacion del que ya esta trabajando.
    db.execute(text("UPDATE app_user SET last_login = now() WHERE id = :i"), {"i": user.id})
    return auth_service.user_out(db, user)


def _poner_password(db: Session, user_id: int, password: str) -> None:
    """Graba la clave y baja la bandera de cambio obligatorio."""
    db.execute(
        text(
            "INSERT INTO user_credential (user_id, password_hash, must_change) "
            "VALUES (:i, :h, false) "
            "ON CONFLICT (user_id) DO UPDATE SET password_hash = :h, "
            "must_change = false, updated_at = now()"
        ),
        {"i": user_id, "h": hash_password(password)},
    )


@router.post("/change-password", response_model=UserOut)
def change_password(
    data: CambioPasswordIn,
    response: Response,
    settings: Settings = Depends(get_settings_dep),
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
) -> UserOut:
    """El propio usuario cambia su clave.

    ⚠️ Hasta hoy esto NO EXISTIA: ni endpoint ni pantalla. La unica manera de
    cambiar una clave era pedirle al administrador que tecleara otra, con lo
    cual el administrador siempre conocia la clave de todos.

    Pide la actual aunque haya sesion abierta: una sesion olvidada en una
    maquina ajena no deberia alcanzar para quedarse con la cuenta.
    """
    fila = db.execute(
        text("SELECT password_hash FROM user_credential WHERE user_id = :i"), {"i": user.id}
    ).first()
    if fila is None or not verify_password(data.current, fila[0]):
        raise Problem(
            status_code=401,
            title="La contrasena actual no coincide",
            detail="Escribi la contrasena con la que entraste.",
        )
    try:
        nueva = validar_password(data.new)
    except PasswordDebil as e:
        raise Problem(status_code=422, title="Contrasena debil", detail=str(e)) from e
    _poner_password(db, user.id, nueva)
    return _login_user(response, settings, db, user)


@router.post("/invite", response_model=InviteOut | UserOut)
def invite(
    data: InviteIn,
    response: Response,
    settings: Settings = Depends(get_settings_dep),
    db: Session = Depends(get_db),
) -> object:
    """Abre o consume un link de invitacion.

    Sin `password` contesta de quien es el link, para saludar a la persona por
    su nombre. Con `password` lo consume: graba la clave, marca la invitacion
    como usada y deja la sesion abierta.

    ⚠️ El token viaja en el link pero en la base vive HASHEADO. Se busca por el
    hash, asi que leer `user_invite` no sirve para entrar.

    ⚠️ Es de un solo uso y vence: `used_at IS NULL AND expires_at > now()`. Un
    link reenviado dos veces no abre la puerta dos veces.
    """
    inv = db.execute(
        text(
            "SELECT i.id, i.user_id, u.full_name, u.email "
            "  FROM user_invite i JOIN app_user u ON u.id = i.user_id "
            " WHERE i.token_hash = :h AND i.used_at IS NULL "
            "   AND i.expires_at > now() AND u.is_active"
        ),
        {"h": hash_invite_token(data.token)},
    ).first()
    if inv is None:
        raise Problem(
            status_code=404,
            title="Invitacion no valida",
            detail="El link ya se uso, vencio, o no existe. Pedi uno nuevo.",
        )
    if data.password is None:
        return InviteOut(full_name=inv[2], email=inv[3])
    try:
        nueva = validar_password(data.password)
    except PasswordDebil as e:
        raise Problem(status_code=422, title="Contrasena debil", detail=str(e)) from e
    _poner_password(db, inv[1], nueva)
    db.execute(text("UPDATE user_invite SET used_at = now() WHERE id = :i"), {"i": inv[0]})
    return _login_user(response, settings, db, db.get(AppUser, inv[1]))


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
