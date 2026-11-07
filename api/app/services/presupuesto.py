"""Propuesta de presupuesto anual, semana por semana.

De dónde sale cada número — es lo único que importa entender de este módulo:

* **Líneas de HITO** (permisos, obras, la cuota de la propiedad): del cronograma
  que ya está cargado. El LEDGER no puede opinar sobre ellas porque **todavía no
  empezaron**: no tienen un solo pago. Inventarles un ritmo sería inventar.

* **Líneas de HÁBITO** (las que se pagan todos los meses): del LEDGER. Él sabe
  el monto que se repite y la semana del mes en que cae; el cronograma no.

El hábito **no está escrito a mano** en ninguna lista: se deduce del historial.
Una línea es de hábito si todavía le queda presupuesto y se pagó en al menos
`MESES_MINIMOS` meses distintos del último año y medio. El día que un contrato
nuevo empiece a pagarse todos los meses, entra solo.

Se usa la **mediana** y no el promedio: un pago doble o un mes salteado corren
el promedio y dejan de describir lo típico.

Este módulo NO escribe nada. Calcula y devuelve.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

# Cuántos meses distintos con pago hacen falta para llamarle hábito a una línea.
MESES_MINIMOS = 6
# Ventana de historial que se mira para deducirlo.
MESES_DE_HISTORIAL = 18


def _lunes_del_anio(anio: int) -> list[dt.date]:
    d = dt.date(anio, 1, 1)
    d += dt.timedelta(days=(7 - d.weekday()) % 7)
    out: list[dt.date] = []
    while d.year == anio:
        out.append(d)
        d += dt.timedelta(days=7)
    return out


def _mediana(xs: list[float]) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def _f(x: Any) -> float:
    if x is None:
        return 0.0
    if isinstance(x, Decimal):
        return float(x)
    return float(x)


def construir(db: Session, anio: int) -> dict[str, Any]:
    semanas = _lunes_del_anio(anio)
    # El primer lunes de cada mes: ahí es donde cae lo recurrente.
    primer_lunes: dict[int, dt.date] = {}
    for w in semanas:
        primer_lunes.setdefault(w.month, w)

    # ── Las líneas, con presupuesto y remanente ────────────────────────────
    lineas = db.execute(
        text(
            """
            SELECT f.wbs_code, f.title, f.category, f.phase, f.owner,
                   f.budget_revised, f.spend, f.remaining
            FROM v_wbs_financials f
            LEFT JOIN wbs_item w ON w.wbs_code = f.wbs_code
            WHERE f.kind = 'cost'
            ORDER BY COALESCE(f.category, 'zzz'), w.sort_order, f.wbs_code
            """
        )
    ).mappings().all()

    # ── Lo que ya está pintado en el cronograma para ese año ───────────────
    plan: dict[str, dict[str, float]] = defaultdict(dict)
    for r in db.execute(
        text(
            """
            SELECT w.wbs_code, s.week_start, SUM(s.planned_amount) AS monto
            FROM schedule_cell s JOIN wbs_item w ON w.id = s.wbs_id
            WHERE EXTRACT(year FROM s.week_start) = :anio
              AND COALESCE(s.planned_amount, 0) <> 0
            GROUP BY 1, 2
            """
        ),
        {"anio": anio},
    ).mappings():
        plan[r["wbs_code"]][str(r["week_start"])] = _f(r["monto"])

    # ── El historial del LEDGER, para deducir el hábito ────────────────────
    desde = dt.date.today() - dt.timedelta(days=30 * MESES_DE_HISTORIAL)
    hist: dict[str, dict[str, float]] = defaultdict(dict)
    semana_del_mes: dict[str, Counter[int]] = defaultdict(Counter)
    for r in db.execute(
        text(
            """
            SELECT w.wbs_code, le.entry_date,
                   COALESCE(le.amount_paid, le.amount, 0) AS monto
            FROM ledger_entry le JOIN wbs_item w ON w.id = le.wbs_id
            WHERE le.entry_date IS NOT NULL AND le.entry_date >= :desde
              AND COALESCE(le.amount_paid, le.amount, 0) <> 0
            """
        ),
        {"desde": desde},
    ).mappings():
        c = r["wbs_code"]
        d: dt.date = r["entry_date"]
        ym = f"{d.year:04d}-{d.month:02d}"
        hist[c][ym] = hist[c].get(ym, 0.0) + _f(r["monto"])
        semana_del_mes[c][min((d.day - 1) // 7 + 1, 4)] += 1

    rem_por_code = {r["wbs_code"]: _f(r["remaining"]) for r in lineas}

    # ── Quién es de hábito ─────────────────────────────────────────────────
    habito: dict[str, dict[str, Any]] = {}
    for code, meses in hist.items():
        if len(meses) < MESES_MINIMOS:
            continue
        if rem_por_code.get(code, 0.0) <= 1:
            continue  # ya terminó: su ritmo es historia, no pronóstico
        mensual = _mediana(list(meses.values()))
        if mensual <= 0:
            continue
        sem = semana_del_mes[code].most_common(1)[0][0] if semana_del_mes[code] else 1
        habito[code] = {
            "mensual": round(mensual, 2),
            "semana_del_mes": sem,
            "meses_con_pago": len(meses),
            "historial": sorted(
                ({"mes": k, "monto": round(v, 2)} for k, v in meses.items()),
                key=lambda x: x["mes"],
            ),
        }

    # ── La propuesta: 12 pagos en la semana que dice el ledger ─────────────
    def lunes_de(mes: int, sem: int) -> dt.date | None:
        base = primer_lunes.get(mes)
        if base is None:
            return None
        cand = base + dt.timedelta(days=7 * (sem - 1))
        return cand if cand.month == mes else base

    filas: list[dict[str, Any]] = []
    for ln in lineas:
        code = ln["wbs_code"]
        rem = _f(ln["remaining"])
        del_plan = plan.get(code, {})
        hb = habito.get(code)
        if rem <= 1 and not del_plan and not hb:
            continue
        if hb:
            propuesta = {}
            for mes in range(1, 13):
                w = lunes_de(mes, hb["semana_del_mes"])
                if w:
                    propuesta[str(w)] = hb["mensual"]
        else:
            propuesta = dict(del_plan)
        filas.append(
            {
                "wbs_code": code,
                "title": ln["title"],
                "category": ln["category"] or "Sin categoría",
                "phase": ln["phase"],
                "owner": ln["owner"],
                "origen": "ledger" if hb else "cronograma",
                "budget_revised": round(_f(ln["budget_revised"]), 2),
                "spend": round(_f(ln["spend"]), 2),
                "remaining": round(rem, 2),
                "plan": del_plan,
                "propuesta": propuesta,
                "plan_total": round(sum(del_plan.values()), 2),
                "propuesta_total": round(sum(propuesta.values()), 2),
            }
        )

    return {
        "anio": anio,
        "semanas": [str(w) for w in semanas],
        "filas": filas,
        "habito": habito,
        "totales": {
            "remanente": round(sum(f["remaining"] for f in filas), 2),
            "plan": round(sum(f["plan_total"] for f in filas), 2),
            "propuesta": round(sum(f["propuesta_total"] for f in filas), 2),
            "lineas": len(filas),
            "lineas_habito": len(habito),
        },
    }
