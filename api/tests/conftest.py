"""Fixtures de prueba. Los tests que tocan la base se saltan si no hay Postgres."""

from __future__ import annotations

import os

import pytest
from app.core.db import engine
from app.main import create_app
from fastapi.testclient import TestClient
from sqlalchemy import text


def _db_available() -> bool:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


requires_db = pytest.mark.skipif(not _db_available(), reason="Postgres no disponible")


@pytest.fixture
def client() -> TestClient:
    os.environ.setdefault("ENV", "dev")
    return TestClient(create_app())


@pytest.fixture
def controller_client(client: TestClient) -> TestClient:
    """Cliente autenticado como el Financial Controller (dev-login)."""
    resp = client.post("/api/auth/dev-login", json={"username": "bismark"})
    assert resp.status_code == 200, resp.text
    return client
