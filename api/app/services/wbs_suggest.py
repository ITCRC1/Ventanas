"""Sugerencia del número de proyecto para líneas del Short Payment.

Una línea que llega de una factura entra SIN proyecto (el owner lo pone a mano).
Casi siempre es el mismo concepto del mes pasado, y ese ya tenía proyecto: acá se
busca en la historia de líneas ya clasificadas y se propone el mismo WBS.

Es una SUGERENCIA: no escribe nada. El owner la aplica con un clic o la ignora
— la regla de la casa es no inventar datos en el libro.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.text import concept_tokens, norm

# Cuánto pesa cada evidencia. El proveedor identifica bien; el concepto idéntico
# identifica mejor; el parecido apenas alcanza para proponer.
_W_SAME_CONCEPT = 3.0
_W_SAME_VENDOR = 2.0
_W_LIKE_CONCEPT = 1.5
_MIN_SCORE = 1.5  # por debajo de esto no se propone nada


def _overlap(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def suggest_for_batch(db: Session, disb_id: int) -> list[dict[str, Any]]:
    """Para cada línea SIN proyecto de la tanda, el WBS más respaldado por la historia."""
    targets = (
        db.execute(
            text(
                "SELECT id, line_no, description, vendor FROM disbursement_line "
                "WHERE disbursement_id = :d AND wbs_id IS NULL ORDER BY line_no"
            ),
            {"d": disb_id},
        )
        .mappings()
        .all()
    )
    if not targets:
        return []

    hist = (
        db.execute(
            text(
                """
                SELECT l.id, l.description, l.vendor, l.wbs_id,
                       w.wbs_code, w.title AS wbs_title,
                       d.disb_no, d.disb_sub
                FROM disbursement_line l
                JOIN wbs_item w     ON w.id = l.wbs_id
                JOIN disbursement d ON d.id = l.disbursement_id
                -- Toda línea ya clasificada sirve de antecedente, incluidas las
                -- de esta misma tanda (si ya asignaste una, la de al lado hereda).
                ORDER BY l.id
                """
            )
        )
        .mappings()
        .all()
    )
    if not hist:
        return []

    # Se precalcula una vez: la historia se recorre por cada línea a sugerir.
    past = [
        {
            "row": h,
            "vendor": norm(h["vendor"]),
            "concept": concept_tokens(h["description"]),
        }
        for h in hist
    ]

    out: list[dict[str, Any]] = []
    for t in targets:
        t_vendor = norm(t["vendor"])
        t_concept = concept_tokens(t["description"])
        if not t_vendor and not t_concept:
            continue

        # wbs_id -> [puntaje, veces, motivos, última fila que lo respalda]
        score: dict[int, float] = {}
        times: dict[int, int] = {}
        why: dict[int, set[str]] = {}
        last: dict[int, Any] = {}

        for p in past:
            s = 0.0
            reasons: set[str] = set()
            if t_vendor and p["vendor"] and t_vendor == p["vendor"]:
                s += _W_SAME_VENDOR
                reasons.add("same vendor")
            if t_concept and p["concept"]:
                if t_concept == p["concept"]:
                    s += _W_SAME_CONCEPT
                    reasons.add("same concept")
                elif _overlap(t_concept, p["concept"]) >= 0.6 and len(t_concept & p["concept"]) >= 2:
                    s += _W_LIKE_CONCEPT
                    reasons.add("similar concept")
            if s <= 0:
                continue
            wid = int(p["row"]["wbs_id"])
            score[wid] = score.get(wid, 0.0) + s
            times[wid] = times.get(wid, 0) + 1
            why.setdefault(wid, set()).update(reasons)
            last[wid] = p["row"]  # la historia viene ordenada: queda la más reciente

        if not score:
            continue
        wid = max(score, key=lambda k: (score[k], int(last[k]["id"])))
        if score[wid] < _MIN_SCORE:
            continue

        row = last[wid]
        motivo = " + ".join(sorted(why[wid]))
        veces = times[wid]
        out.append(
            {
                "line_id": t["id"],
                "line_no": t["line_no"],
                "wbs_id": wid,
                "wbs_code": row["wbs_code"],
                "wbs_title": row["wbs_title"],
                "times": veces,
                "reason": (
                    f"{motivo} · {veces} previous line{'s' if veces != 1 else ''} · "
                    f"last in #{row['disb_no']}.{row['disb_sub']}"
                ),
            }
        )
    return out
