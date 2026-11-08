"""Administración de perfiles (roles) y usuarios. Todo tras `admin.users`.

Los perfiles son DATO (tabla role + role_permission), editables sin desplegar:
se define qué secciones ve cada perfil y se asignan usuarios por correo.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.permissions import require_permission
from app.core.problems import Problem
from app.core.security import INVITE_DAYS, nueva_invitacion
from app.deps import get_current_user, get_db
from app.models.access import AppUser
from app.schemas.admin import (
    InviteOut,
    PermissionOut,
    RoleIn,
    RolePermsIn,
    RoleUpdate,
    UserIn,
    UserOut,
    UserUpdate,
)

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_permission("admin.users"))],
)

# Cómo se agrupan los permisos en la UI del editor de perfiles.
_VIEW = {
    "view.jobcost", "view.timeline", "report.view", "view.planning",
    "view.payments", "view.invoices", "view.ledger", "bank.view",
}
_ADMIN = {"admin.users"}


def _group(code: str) -> str:
    if code in _ADMIN:
        return "admin"
    if code in _VIEW:
        return "view"
    return "action"


# --- Catálogo de permisos ----------------------------------------------------


@router.get("/permissions", response_model=list[PermissionOut])
def permissions(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    rows = db.execute(
        text("SELECT code, description FROM permission ORDER BY code")
    ).mappings().all()
    return [{"code": r["code"], "description": r["description"], "group": _group(r["code"])} for r in rows]


# --- Perfiles (roles) --------------------------------------------------------


@router.get("/roles")
def list_roles(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    roles = db.execute(text("SELECT id, code, name FROM role ORDER BY id")).mappings().all()
    perms = db.execute(
        text("SELECT role_id, permission FROM role_permission")
    ).mappings().all()
    counts = db.execute(
        text("SELECT role_id, count(*) AS n FROM app_user GROUP BY role_id")
    ).mappings().all()
    by_role: dict[int, list[str]] = {}
    for p in perms:
        by_role.setdefault(p["role_id"], []).append(p["permission"])
    cmap = {c["role_id"]: c["n"] for c in counts}
    return [
        {
            "id": r["id"], "code": r["code"], "name": r["name"],
            "permissions": sorted(by_role.get(r["id"], [])),
            "user_count": cmap.get(r["id"], 0),
        }
        for r in roles
    ]


@router.post("/roles", status_code=201)
def create_role(data: RoleIn, db: Session = Depends(get_db)) -> dict[str, Any]:
    exists = db.execute(
        text("SELECT 1 FROM role WHERE code = :c"), {"c": data.code}
    ).scalar_one_or_none()
    if exists:
        raise Problem(status_code=409, title="Ya existe un perfil con ese código")
    rid = db.execute(
        text("INSERT INTO role (code, name) VALUES (:c, :n) RETURNING id"),
        {"c": data.code, "n": data.name},
    ).scalar_one()
    return {"id": int(rid), "code": data.code, "name": data.name}


@router.patch("/roles/{role_id}")
def rename_role(role_id: int, data: RoleUpdate, db: Session = Depends(get_db)) -> dict[str, Any]:
    row = db.execute(
        text("UPDATE role SET name = :n WHERE id = :i RETURNING id, code, name"),
        {"n": data.name, "i": role_id},
    ).mappings().one_or_none()
    if row is None:
        raise Problem(status_code=404, title="Perfil no encontrado")
    return dict(row)


@router.put("/roles/{role_id}/permissions")
def set_role_permissions(
    role_id: int, data: RolePermsIn, db: Session = Depends(get_db)
) -> dict[str, Any]:
    """Reemplaza el set de permisos del perfil por el recibido."""
    if db.execute(text("SELECT 1 FROM role WHERE id = :i"), {"i": role_id}).scalar_one_or_none() is None:
        raise Problem(status_code=404, title="Perfil no encontrado")
    valid = set(db.execute(text("SELECT code FROM permission")).scalars())
    wanted = [p for p in data.permissions if p in valid]
    db.execute(text("DELETE FROM role_permission WHERE role_id = :i"), {"i": role_id})
    for p in wanted:
        db.execute(
            text("INSERT INTO role_permission (role_id, permission) VALUES (:r, :p) "
                 "ON CONFLICT DO NOTHING"),
            {"r": role_id, "p": p},
        )
    return {"role_id": role_id, "permissions": sorted(wanted)}


@router.delete("/roles/{role_id}", status_code=204)
def delete_role(role_id: int, db: Session = Depends(get_db)) -> None:
    n = db.execute(
        text("SELECT count(*) FROM app_user WHERE role_id = :i"), {"i": role_id}
    ).scalar_one()
    if n:
        raise Problem(
            status_code=409,
            title="El perfil tiene usuarios",
            detail=f"Reasigná los {n} usuario(s) a otro perfil antes de borrarlo.",
        )
    db.execute(text("DELETE FROM role WHERE id = :i"), {"i": role_id})


# --- Usuarios ----------------------------------------------------------------

_USER_SQL = """
SELECT u.id, u.username, u.full_name, u.email, u.role_id, r.name AS role, u.is_active,
       (c.user_id IS NOT NULL) AS has_password,
       u.last_login,
       -- Hay una invitacion viva sin usar: la persona todavia no entro.
       EXISTS (SELECT 1 FROM user_invite i
                WHERE i.user_id = u.id AND i.used_at IS NULL
                  AND i.expires_at > now()) AS invite_pending
  FROM app_user u
  JOIN role r ON r.id = u.role_id
  LEFT JOIN user_credential c ON c.user_id = u.id
 ORDER BY u.full_name
"""


def _crear_invitacion(db: Session, user_id: int, creado_por: int | None) -> str:
    """Una invitacion nueva, y las anteriores de esa persona quedan muertas.

    ⚠️ Se guarda el HASH del token. El token en claro se devuelve una sola vez,
    en esta respuesta: si el administrador pierde el link, se emite otro, no se
    recupera el viejo.
    """
    token, token_hash = nueva_invitacion()
    # Invalidar las anteriores: dos links vivos para la misma persona son dos
    # puertas abiertas, y basta con la ultima.
    db.execute(
        text("UPDATE user_invite SET used_at = now() "
             "WHERE user_id = :u AND used_at IS NULL"),
        {"u": user_id},
    )
    db.execute(
        text(
            "INSERT INTO user_invite (user_id, token_hash, expires_at, created_by) "
            "VALUES (:u, :h, now() + make_interval(days => :d), :c)"
        ),
        {"u": user_id, "h": token_hash, "d": INVITE_DAYS, "c": creado_por},
    )
    return token


@router.get("/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)) -> list[dict[str, Any]]:
    return [dict(r) for r in db.execute(text(_USER_SQL)).mappings().all()]


def _username_from_email(db: Session, email: str) -> str:
    base = email.split("@")[0].strip().lower() or "user"
    name = base
    i = 1
    while db.execute(text("SELECT 1 FROM app_user WHERE username = :u"), {"u": name}).scalar_one_or_none():
        i += 1
        name = f"{base}{i}"
    return name


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    data: UserIn,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
) -> dict[str, Any]:
    email = data.email.strip().lower()
    if db.execute(text("SELECT 1 FROM app_user WHERE lower(email) = :e"), {"e": email}).scalar_one_or_none():
        raise Problem(status_code=409, title="Ya existe un usuario con ese correo")
    if db.execute(text("SELECT 1 FROM role WHERE id = :i"), {"i": data.role_id}).scalar_one_or_none() is None:
        raise Problem(status_code=422, title="Perfil inválido")
    username = _username_from_email(db, email)
    uid = db.execute(
        text(
            "INSERT INTO app_user (username, full_name, email, role_id, is_active) "
            "VALUES (:u, :f, :e, :r, true) RETURNING id"
        ),
        {"u": username, "f": data.full_name, "e": email, "r": data.role_id},
    ).scalar_one()
    # ⚠️ No se graba ninguna clave. El administrador se lleva un link y la
    # persona elige la suya. Antes el admin tecleaba una clave y se la mandaba
    # por WhatsApp: viajaba en claro, quedaba en el historial del chat, y el
    # admin la conocia para siempre.
    token = _crear_invitacion(db, uid, user.id)
    fila = dict(
        db.execute(
            text(_USER_SQL.replace("ORDER BY u.full_name", "WHERE u.id = :i")), {"i": uid}
        ).mappings().one()
    )
    fila["invite_token"] = token
    fila["invite_days"] = INVITE_DAYS
    return fila


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db)) -> dict[str, Any]:
    fields = data.model_dump(exclude_unset=True)
    if "email" in fields and fields["email"]:
        fields["email"] = fields["email"].strip().lower()
        clash = db.execute(
            text("SELECT 1 FROM app_user WHERE lower(email) = :e AND id <> :i"),
            {"e": fields["email"], "i": user_id},
        ).scalar_one_or_none()
        if clash:
            raise Problem(status_code=409, title="Otro usuario ya usa ese correo")
    if "role_id" in fields and db.execute(
        text("SELECT 1 FROM role WHERE id = :i"), {"i": fields["role_id"]}
    ).scalar_one_or_none() is None:
        raise Problem(status_code=422, title="Perfil inválido")
    allowed = {"full_name", "email", "role_id", "is_active"}
    sets = {k: v for k, v in fields.items() if k in allowed}
    if sets:
        clause = ", ".join(f"{k} = :{k}" for k in sets)
        db.execute(text(f"UPDATE app_user SET {clause} WHERE id = :id"), {**sets, "id": user_id})  # noqa: S608
    row = db.execute(text(_USER_SQL.replace("ORDER BY u.full_name", "WHERE u.id = :i")), {"i": user_id}).mappings().one_or_none()  # noqa: E501
    if row is None:
        raise Problem(status_code=404, title="Usuario no encontrado")
    return dict(row)


@router.post("/users/{user_id}/invite", response_model=InviteOut)
def reinvite_user(
    user_id: int,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
) -> dict[str, Any]:
    """Un link nuevo: para quien no abrio el primero, o para reiniciar la clave.

    ⚠️ Reemplaza al viejo `POST /users/{id}/password`, donde el administrador
    tecleaba la clave. Aca no la ve ni la elige. Si alguien queda afuera y hace
    falta la salida de emergencia, sigue estando `etl/set_password.py`, que
    escribe directo contra la base.
    """
    if db.execute(
        text("SELECT 1 FROM app_user WHERE id = :i"), {"i": user_id}
    ).scalar_one_or_none() is None:
        raise Problem(status_code=404, title="Usuario no encontrado")
    return {"invite_token": _crear_invitacion(db, user_id, user.id), "invite_days": INVITE_DAYS}
