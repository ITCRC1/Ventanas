"""Bitácora del proyecto — entradas que sólo se agregan.

Owner, 2026-10-06: *«quiero ir poniendo todas estas notas importantes para que
queden registradas… ningún blog se puede borrar una vez puesto»* y, enseguida:
*«no se puede borrar ni a mano»*.

## Acá no hay ruta de borrado, y no es un olvido

Este router expone `GET` y `POST`. No existe `DELETE` ni `PATCH` ni `PUT`:
borrar una entrada no es una operación que la aplicación pueda pedir, así que
no tiene endpoint. El motor además lo rechaza —`finding_log` tiene un trigger
que revienta en UPDATE, DELETE y TRUNCATE (migración 0051)—, pero esa es la
segunda línea. La primera es que la puerta no esté.

## Corregir es agregar

Una entrada equivocada no se arregla: se escribe una nueva con `supersedes`
apuntando a la vieja. Las dos quedan, y la bitácora conserva qué se supo y
cuándo — que es exactamente lo que se pierde cuando alguien edita una nota
vieja en silencio. Es la misma doctrina de «nada de soft-delete» del resto del
esquema.

## Leer es parte de ver reportes; escribir se firma

`GET` pide sesión y nada más: la bitácora es para que la lea quien trabaja el
proyecto. `POST` pide `blog.post`, porque una constancia sin autor no sirve de
constancia.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.core.problems import Problem
from app.deps import CurrentUser, get_current_user, get_db

router = APIRouter(
    prefix="/blog",
    tags=["bitacora"],
    dependencies=[Depends(get_current_user)],
)


class EntradaIn(BaseModel):
    """Lo que se puede escribir. `log_no` no está: lo pone la base."""

    subject: str = Field(min_length=1, max_length=200)
    finding: str = Field(min_length=1)
    action: str | None = None
    source: str | None = None
    #: El CONSECUTIVO de la entrada que ésta reemplaza — el número que se ve en
    #: pantalla, no el id interno. Quien escribe lee «#001», no una llave.
    supersedes: int | None = None


@router.get("")
def listar(db: Session = Depends(get_db)) -> dict[str, Any]:
    """La bitácora completa, del consecutivo más viejo al más nuevo.

    Sin paginar y a propósito: una bitácora se lee entera o no prueba nada, y
    son unas pocas entradas al mes.
    """
    filas = db.execute(text("SELECT * FROM v_finding_log")).mappings().all()
    return {"entries": [dict(f) for f in filas]}


@router.post("", status_code=201)
def crear(
    body: EntradaIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_permission("blog.post")),
) -> dict[str, Any]:
    """Agrega una entrada. El consecutivo lo asigna la base, no el cliente."""
    reemplaza: int | None = None
    if body.supersedes is not None:
        reemplaza = db.execute(
            text("SELECT id FROM finding_log WHERE log_no = :n"),
            {"n": body.supersedes},
        ).scalar()
        if reemplaza is None:
            raise Problem(
                status_code=404,
                title="Entrada desconocida",
                detail=f"No existe la entrada #{body.supersedes} en la bitácora.",
            )

    fila = (
        db.execute(
            text(
                "INSERT INTO finding_log "
                "  (subject, finding, action, source, supersedes, created_by) "
                "VALUES (:s, :f, :a, :src, :sup, :u) "
                "RETURNING log_no, logged_at"
            ),
            {
                "s": body.subject.strip(),
                "f": body.finding.strip(),
                "a": (body.action or "").strip() or None,
                "src": (body.source or "").strip() or None,
                "sup": reemplaza,
                "u": user.id,
            },
        )
        .mappings()
        .first()
    )
    db.commit()
    return {"log_no": fila["log_no"], "logged_at": fila["logged_at"]}
