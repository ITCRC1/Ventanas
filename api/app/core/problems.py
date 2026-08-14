"""Errores en formato RFC 7807 (application/problem+json, §2 DECISIONES).

Los mensajes de error van en español (§6).
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, ProgrammingError
from starlette.exceptions import HTTPException as StarletteHTTPException

CONTENT_TYPE = "application/problem+json"


class Problem(Exception):
    """Error de negocio que se serializa como problem+json."""

    def __init__(
        self,
        status_code: int,
        title: str,
        detail: str | None = None,
        type_: str = "about:blank",
        **extra: Any,
    ) -> None:
        self.status_code = status_code
        self.title = title
        self.detail = detail
        self.type_ = type_
        self.extra = extra
        super().__init__(detail or title)


def _problem_response(
    status_code: int, title: str, detail: str | None, type_: str = "about:blank", **extra: Any
) -> JSONResponse:
    body: dict[str, Any] = {"type": type_, "title": title, "status": status_code}
    if detail:
        body["detail"] = detail
    body.update(extra)
    return JSONResponse(status_code=status_code, content=body, media_type=CONTENT_TYPE)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(Problem)
    async def _handle_problem(_: Request, exc: Problem) -> JSONResponse:
        return _problem_response(exc.status_code, exc.title, exc.detail, exc.type_, **exc.extra)

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _problem_response(exc.status_code, str(exc.detail), None)

    @app.exception_handler(RequestValidationError)
    async def _handle_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return _problem_response(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Datos inválidos",
            "La solicitud no pasó la validación.",
            errors=exc.errors(),
        )

    @app.exception_handler(IntegrityError)
    async def _handle_integrity(_: Request, exc: IntegrityError) -> JSONResponse:
        # Los triggers/constraints del esquema lanzan mensajes en español ya legibles.
        detail = getattr(getattr(exc, "orig", None), "diag", None)
        msg = getattr(detail, "message_primary", None) or "Violación de integridad de datos."
        return _problem_response(status.HTTP_409_CONFLICT, "Conflicto de datos", msg)

    @app.exception_handler(ProgrammingError)
    async def _handle_programming(_: Request, exc: ProgrammingError) -> JSONResponse:
        orig = getattr(exc, "orig", None)
        msg = getattr(getattr(orig, "diag", None), "message_primary", None) or str(orig or exc)
        return _problem_response(status.HTTP_400_BAD_REQUEST, "Operación rechazada", msg)
