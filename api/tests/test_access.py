"""Autenticación y permisos (requieren base con el seed 0002 aplicado)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import requires_db


@requires_db
def test_dev_login_controller(controller_client: TestClient) -> None:
    me = controller_client.get("/api/auth/me").json()
    assert me["role"] == "controller"
    assert "bank.view" in me["permissions"]


@requires_db
def test_viewer_cannot_edit_wbs(client: TestClient) -> None:
    client.post("/api/auth/dev-login", json={"username": "ronald"})
    resp = client.post("/api/wbs", json={"wbs_code": "TEST-1", "title": "x"})
    assert resp.status_code == 403


@requires_db
def test_reassignment_queue_report(controller_client: TestClient) -> None:
    resp = controller_client.get("/api/reports/reassignment-queue")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
