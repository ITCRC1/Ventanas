"""Sugerencia del número de proyecto en el Short Payment.

Lo que se prueba es lo que costaría un error: que el CONCEPTO sobreviva al
cambio de mes (si no, ninguna línea empareja con la del mes pasado) y que la
sugerencia salga con el proyecto de la línea vieja.
"""

from __future__ import annotations

from typing import Any

import pytest
from app.core.text import concept_tokens
from app.services.wbs_suggest import suggest_for_batch
from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.conftest import requires_db


def test_el_mes_no_forma_parte_del_concepto() -> None:
    """'Jan 2026 · Development Team' y 'Feb 2026 · Development Team' son lo mismo."""
    assert concept_tokens("Jan 2026 · Development Team") == concept_tokens(
        "Feb 2026 · Development Team"
    )
    assert concept_tokens("Pago agosto CCSS planilla") == concept_tokens(
        "Pago setiembre CCSS planilla"
    )
    # Y no se vacía: queda el concepto de verdad.
    assert concept_tokens("Jan 2026 · Development Team") == {"development", "team"}


def test_sin_texto_no_sugiere() -> None:
    assert concept_tokens(None) == set()
    assert concept_tokens("2026 08 01") == set()


@requires_db
def test_sugiere_el_proyecto_de_la_linea_anterior(controller_client: TestClient) -> None:
    """Una línea sin proyecto hereda el WBS de la línea vieja del mismo concepto."""
    from app.core.db import SessionLocal

    db = SessionLocal()
    creados: dict[str, Any] = {}
    try:
        wbs_id = db.execute(text("SELECT id FROM wbs_item WHERE kind = 'cost' LIMIT 1")).scalar()
        if wbs_id is None:
            pytest.skip("la base no tiene wbs_item")

        # Tanda vieja, con la línea YA clasificada.
        vieja = db.execute(
            text(
                "INSERT INTO disbursement (disb_no, disb_sub, period_month, status) "
                "VALUES (9990, 0, DATE '2026-01-01', 'draft') RETURNING id"
            )
        ).scalar_one()
        creados["vieja"] = vieja
        db.execute(
            text(
                "INSERT INTO disbursement_line "
                "  (disbursement_id, line_no, description, amount, currency, wbs_id, vendor) "
                "VALUES (:d, 1, 'Jan 2026 - Servicios de ingenieria', 100, 'USD', :w, 'ACME SA')"
            ),
            {"d": vieja, "w": wbs_id},
        )

        # Tanda nueva: la misma línea del mes siguiente, SIN proyecto.
        nueva = db.execute(
            text(
                "INSERT INTO disbursement (disb_no, disb_sub, period_month, status) "
                "VALUES (9991, 0, DATE '2026-02-01', 'draft') RETURNING id"
            )
        ).scalar_one()
        creados["nueva"] = nueva
        db.execute(
            text(
                "INSERT INTO disbursement_line "
                "  (disbursement_id, line_no, description, amount, currency, vendor) "
                "VALUES (:d, 1, 'Feb 2026 - Servicios de ingenieria', 100, 'USD', 'ACME SA')"
            ),
            {"d": nueva},
        )
        db.commit()

        sug = suggest_for_batch(db, nueva)
        assert len(sug) == 1, sug
        assert sug[0]["wbs_id"] == wbs_id
        assert "same concept" in sug[0]["reason"]

        # Y por la puerta de la API, que es como lo consume la pantalla.
        resp = controller_client.get(f"/api/disbursements/{nueva}/wbs-suggestions")
        assert resp.status_code == 200, resp.text
        assert resp.json()[0]["wbs_id"] == wbs_id

        # La tanda vieja no tiene nada que sugerir: su línea ya tiene proyecto.
        assert suggest_for_batch(db, vieja) == []
    finally:
        for did in creados.values():
            db.execute(text("DELETE FROM disbursement WHERE id = :i"), {"i": did})
        db.commit()
        db.close()
