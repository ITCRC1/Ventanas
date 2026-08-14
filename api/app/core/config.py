"""Configuración por variable de entorno (pydantic-settings, §2 DECISIONES)."""

from __future__ import annotations

from decimal import Decimal
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Base de datos --------------------------------------------------------
    # SQLAlchemy 2.0 + psycopg 3 (driver sync). Reportes con SQL crudo.
    database_url: str = Field(
        default="postgresql+psycopg://localhost:5433/dashboard_ventanas",
        description="URL SQLAlchemy con driver psycopg3",
    )

    @field_validator("database_url")
    @classmethod
    def _force_psycopg(cls, v: str) -> str:
        # Railway (y muchos proveedores) entregan 'postgresql://...'. SQLAlchemy
        # sin sufijo usa psycopg2, que no está instalado: forzamos psycopg3.
        if v.startswith("postgresql://"):
            return v.replace("postgresql://", "postgresql+psycopg://", 1)
        if v.startswith("postgres://"):
            return v.replace("postgres://", "postgresql+psycopg://", 1)
        return v

    # --- App ------------------------------------------------------------------
    env: Literal["dev", "prod"] = "dev"
    app_name: str = "Dashboard Ventanas API"
    api_prefix: str = "/api"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    # URL pública del front (la del servicio web en Railway). Se usa para volver
    # a la app después del callback de OIDC. Vacío = primer origen de CORS.
    web_base_url: str = ""

    # --- Sesión / JWT ---------------------------------------------------------
    jwt_secret: str = Field(default="dev-insecure-change-me", description="Firma del JWT de sesión")
    jwt_algorithm: str = "HS256"
    session_hours: int = 8
    cookie_name: str = "ventanas_session"
    cookie_secure: bool = False  # true en prod (https)
    cookie_samesite: Literal["lax", "strict", "none"] = "lax"

    # --- OIDC Microsoft 365 ---------------------------------------------------
    oidc_enabled: bool = False
    oidc_tenant_id: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = ""
    oidc_redirect_uri: str = "http://localhost:8000/api/auth/callback"
    # login de desarrollo sin Azure: SOLO en env=dev
    dev_login_enabled: bool = True
    # portón de contraseña compartida (mientras no esté OIDC). Si se fija, cualquiera
    # con la clave entra como shared_login_user. Pensado para la demo/URL pública.
    shared_password: str = ""
    shared_login_user: str = "bismark"

    # --- Invoice Receipts (bandeja de facturas por correo) --------------------
    # Buzón IMAP donde llegan las facturas electrónicas. La contraseña es un
    # App Password de Gmail (2FA + contraseña de aplicación), NO la del correo.
    invoice_imap_host: str = "imap.gmail.com"
    invoice_imap_port: int = 993
    invoice_imap_user: str = ""
    invoice_imap_password: str = ""
    invoice_imap_folder: str = "INBOX"
    # Cada cuánto revisa el buzón automáticamente (minutos). 0 = solo manual.
    invoice_sync_interval_min: int = 15

    @property
    def invoice_mail_configured(self) -> bool:
        return bool(self.invoice_imap_user and self.invoice_imap_password)

    # --- Endurecimiento (Fase 11) ---------------------------------------------
    # Desembolsos por encima de este monto exigen DOS aprobadores distintos.
    disb_approval_threshold: Decimal = Decimal(25000)
    # Rate limit del login: intentos por ventana y ventana en segundos.
    login_rate_limit: int = 10
    login_rate_window_s: int = 60

    @property
    def oidc_metadata_url(self) -> str:
        return (
            f"https://login.microsoftonline.com/{self.oidc_tenant_id}"
            "/v2.0/.well-known/openid-configuration"
        )

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"

    @property
    def web_url(self) -> str:
        """A dónde volver después del callback de OIDC."""
        if self.web_base_url:
            return self.web_base_url.rstrip("/")
        return self.cors_origins[0] if self.cors_origins else "/"

    @model_validator(mode="after")
    def _prod_hardening(self) -> Settings:
        # En prod la app va detrás de HTTPS siempre: la cookie de sesión se
        # marca secure sí o sí, sin depender de que alguien acuerde la variable.
        if self.env == "prod":
            self.cookie_secure = True
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
