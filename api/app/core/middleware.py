"""Middleware de endurecimiento (Fase 11): security headers + rate limit del login."""

from __future__ import annotations

import time
from collections import defaultdict, deque

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

from app.core.config import Settings
from app.core.problems import CONTENT_TYPE

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
}

# ventana deslizante por IP, sólo en memoria (por worker). Suficiente para frenar
# fuerza bruta sobre la contraseña; no es un WAF.
#
# OJO: /api/auth/login TIENE que estar. Es el único camino de acceso real en
# producción —dev-login devuelve 404 con ENV=prod y shared-login está apagado—,
# y sin él quedaba admitiendo intentos de contraseña sin límite.
_LOGIN_PATHS = frozenset({"/api/auth/login", "/api/auth/shared-login", "/api/auth/dev-login"})
_hits: dict[str, deque[float]] = defaultdict(deque)


class SecurityMiddleware:
    """ASGI middleware: agrega security headers y limita intentos de login."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.limit = settings.login_rate_limit
        self.window = settings.login_rate_window_s

    async def __call__(self, scope, receive, send) -> None:  # type: ignore[no-untyped-def]
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        is_login = request.method == "POST" and request.url.path in _LOGIN_PATHS
        if is_login and self._too_many(request):
            resp = JSONResponse(
                status_code=429,
                media_type=CONTENT_TYPE,
                content={
                    "type": "about:blank",
                    "title": "Demasiados intentos",
                    "status": 429,
                    "detail": "Esperá un momento antes de reintentar.",
                },
            )
            await resp(scope, receive, send)
            return

        async def send_with_headers(message):  # type: ignore[no-untyped-def]
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                for k, v in _SECURITY_HEADERS.items():
                    headers.append((k.encode(), v.encode()))
            await send(message)

        await self.app(scope, receive, send_with_headers)

    def _too_many(self, request: Request) -> bool:
        ip = request.client.host if request.client else "anon"
        now = time.monotonic()
        q = _hits[ip]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            return True
        q.append(now)
        return False


def add_security_headers(response: Response) -> None:
    for k, v in _SECURITY_HEADERS.items():
        response.headers.setdefault(k, v)
