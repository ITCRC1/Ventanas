"""Punto de entrada de la API — DASHBOARD VENTANAS (Fase 3)."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.core.middleware import SecurityMiddleware
from app.core.problems import register_exception_handlers
from app.routers import (
    admin,
    auth,
    bank,
    catalog,
    disbursements,
    export,
    health,
    invoice_receipts,
    invoices,
    ledger,
    planning,
    public,
    reports,
    schedule,
    us_wires,
    wbs,
)

settings = get_settings()
configure_logging()
log = get_logger()


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, version="0.1.0")

    # Endurecimiento: security headers + rate limit del login (§Fase 11).
    app.add_middleware(SecurityMiddleware, settings=settings)
    # State del flujo OIDC (authlib lo guarda en la sesión firmada de Starlette).
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.jwt_secret,
        same_site="lax",
        https_only=settings.cookie_secure,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_exception_handlers(app)

    p = settings.api_prefix
    app.include_router(health.router, prefix=p)
    app.include_router(auth.router, prefix=p)
    app.include_router(admin.router, prefix=p)
    app.include_router(catalog.router, prefix=p)
    app.include_router(wbs.router, prefix=p)
    app.include_router(ledger.router, prefix=p)
    app.include_router(schedule.router, prefix=p)
    app.include_router(disbursements.router, prefix=p)
    app.include_router(bank.router, prefix=p)
    app.include_router(invoices.router, prefix=p)
    app.include_router(invoice_receipts.router, prefix=p)
    app.include_router(us_wires.router, prefix=p)
    app.include_router(planning.router, prefix=p)
    app.include_router(public.router, prefix=p)
    app.include_router(reports.router, prefix=p)
    app.include_router(export.router, prefix=p)

    @app.get("/")
    def root() -> dict[str, str]:
        return {"service": settings.app_name, "docs": "/docs"}

    # Auto-sync de facturas por correo (dormido si el buzón no está configurado).
    from app.services import invoice_scheduler

    invoice_scheduler.start()

    log.info("app.startup", env=settings.env, oidc=settings.oidc_enabled)
    return app


app = create_app()
