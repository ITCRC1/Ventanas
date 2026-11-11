"""El candado contra quedarse sin administración.

Owner, 2026-11-10: *«me cambie el usuario a corporativo para ver que veia pero
ahora no puedo regresar a mi vista..y no me puedo cambiar»*. Se cambió su
propio perfil a uno sin `admin.users`, perdió la pestaña Admin y con ella la
única forma de volver. Hubo que devolverle el perfil desde la base.

⚠️ Antes de cerrar la API por pantalla (2026-11-10) esto NO encerraba: el menú
escondía la pestaña pero la URL seguía abriendo. El candado es la contraparte
de ese cambio, y estos tests son lo que evita que se caiga sin que nadie note.

⚠️ CADA TEST RESTAURA LO QUE TOCÓ, en un `finally`. Son pruebas que esperan un
RECHAZO: si el candado se rompe, el cambio se aplica de verdad, y sin el
`finally` la prueba que vigila el bloqueo sería la que lo provoca.
"""

from __future__ import annotations

from typing import Any

import pytest
from app.core.db import engine
from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.conftest import requires_db


def _consulta(sql: str, **p: Any) -> Any:
    with engine.connect() as c:
        return c.execute(text(sql), p).first()


def _rol_sin_admin() -> int | None:
    """Un perfil que exista y NO tenga `admin.users`."""
    r = _consulta(
        "SELECT r.id FROM role r"
        " WHERE NOT EXISTS (SELECT 1 FROM role_permission rp"
        "                    WHERE rp.role_id = r.id AND rp.permission = 'admin.users')"
        " LIMIT 1"
    )
    return int(r[0]) if r else None


def _yo(cli: TestClient) -> dict[str, Any]:
    me = cli.get("/api/auth/me")
    assert me.status_code == 200, me.text
    return me.json()


@requires_db
def test_no_puedo_cambiarme_a_un_perfil_que_no_administra(
    controller_client: TestClient,
) -> None:
    """El camino exacto por el que el owner se encerró."""
    yo = _yo(controller_client)
    uid, rol_original = yo["id"], yo["role_id"]
    destino = _rol_sin_admin()
    if destino is None:
        pytest.skip("no hay ningún perfil sin admin.users con el que probar")

    try:
        r = controller_client.patch(f"/api/admin/users/{uid}", json={"role_id": destino})
        assert r.status_code == 409, f"el candado no frenó el cambio: {r.status_code} {r.text}"
        # Y de verdad no cambió nada.
        assert _yo(controller_client)["role_id"] == rol_original
    finally:
        # Si el candado se rompió, esto devuelve el acceso. Va directo a la
        # base: si el cambio se aplicó, la API ya no lo dejaría volver.
        with engine.begin() as c:
            c.execute(
                text("UPDATE app_user SET role_id = :r WHERE id = :i"),
                {"r": rol_original, "i": uid},
            )


@requires_db
def test_no_puedo_quitarle_la_administracion_a_mi_propio_perfil(
    controller_client: TestClient,
) -> None:
    yo = _yo(controller_client)
    rol = yo["role_id"]
    antes = _consulta(
        "SELECT COUNT(*) FROM role_permission WHERE role_id = :i", i=rol
    )[0]

    try:
        # Mandar el set de permisos SIN `admin.users`.
        quedan = [p for p in yo["permissions"] if p != "admin.users"]
        r = controller_client.put(
            f"/api/admin/roles/{rol}/permissions", json={"permissions": quedan}
        )
        assert r.status_code == 409, f"el candado no frenó el cambio: {r.status_code} {r.text}"
        assert "admin.users" in _yo(controller_client)["permissions"]
    finally:
        # Reponer el permiso pase lo que pase.
        with engine.begin() as c:
            c.execute(
                text(
                    "INSERT INTO role_permission (role_id, permission)"
                    " VALUES (:r, 'admin.users') ON CONFLICT DO NOTHING"
                ),
                {"r": rol},
            )
        assert (
            _consulta("SELECT COUNT(*) FROM role_permission WHERE role_id = :i", i=rol)[0]
            == antes
        ), "el perfil quedó con otros permisos que al empezar"


@requires_db
def test_no_puedo_desactivarme(controller_client: TestClient) -> None:
    uid = _yo(controller_client)["id"]
    try:
        r = controller_client.patch(f"/api/admin/users/{uid}", json={"is_active": False})
        assert r.status_code == 409, f"el candado no frenó el cambio: {r.status_code} {r.text}"
    finally:
        with engine.begin() as c:
            c.execute(text("UPDATE app_user SET is_active = true WHERE id = :i"), {"i": uid})


@requires_db
def test_si_puedo_cambiar_a_OTRA_persona(controller_client: TestClient) -> None:
    """⚠️ El candado tiene que frenar el auto-bloqueo y NADA MAS.

    Un candado que ademas impida administrar a los demas se desactiva al dia
    siguiente, y entonces no protege de nada.
    """
    yo = _yo(controller_client)
    otro = _consulta(
        "SELECT id, role_id FROM app_user WHERE id <> :i AND is_active LIMIT 1", i=yo["id"]
    )
    if otro is None:
        pytest.skip("no hay otro usuario activo con el que probar")
    uid, rol_original = int(otro[0]), int(otro[1])
    destino = _rol_sin_admin()
    if destino is None:
        pytest.skip("no hay ningún perfil sin admin.users con el que probar")

    try:
        r = controller_client.patch(f"/api/admin/users/{uid}", json={"role_id": destino})
        assert r.status_code == 200, f"el candado frenó un cambio legítimo: {r.text}"
    finally:
        with engine.begin() as c:
            c.execute(
                text("UPDATE app_user SET role_id = :r WHERE id = :i"),
                {"r": rol_original, "i": uid},
            )
