"""Presupuesto anual por semana, con el JOB COST como estándar.

Regla de oro de este módulo: **ninguna línea del Job Cost queda afuera.** Las 78
salen, tengan remanente o no, tengan plan o no. Una línea que no aparece es una
línea que nadie revisa, y en un presupuesto eso es exactamente lo que no se
puede permitir.

De dónde sale cada número
-------------------------
Todo del Job Cost. `remaining` manda: es lo que le queda a la línea. El
cronograma dice CUÁNDO, y se parte en tres tramos que tienen que sumar el
remanente:

    vencido   — planeado para una semana QUE YA PASÓ y que sigue en el
                remanente: se presupuestó, no se ejecutó, y nadie lo movió.
    arrastre  — lo planeado ANTES del año que se presupuesta y que todavía no
                pasó. Con el año siguiente eso es «lo que queda de este año»,
                que es el caso normal. ⚠️ Con un año más lejano son TAMBIÉN los
                años del medio: pidiendo 2028 desde nov-2026, el arrastre trae
                los doce meses de 2027 ($4.7 M). El número es correcto —falta
                por ejecutar antes del año pedido— pero la pantalla cambia el
                rótulo a «Pending before <año>» para no llamarlo «este año».
    plan      — lo planeado dentro del año que se presupuesta.
    posterior — lo planeado en años más adelante.

    propuesta = vencido + arrastre + plan

Lo anterior al corte del forecast no cuenta: eso es historia del ledger, ya
gastada. El `vencido` empieza en el corte.

El arrastre se coloca en la primera semana del año, marcado. No es una opinión
sobre cuándo se va a gastar: es ponerlo donde se vea, para que alguien lo mueva
a sabiendas en vez de que desaparezca del año.

El LEDGER no participa del cálculo. Aparece solo como dato al costado —cuánto
paga por mes esa línea en la realidad— para poder contrastar, pero no mueve un
solo número.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

MESES_DE_HISTORIAL = 18
MESES_MINIMOS = 6


def _lunes(anio: int) -> list[dt.date]:
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
    return float(x) if isinstance(x, (int, float, Decimal)) and x is not None else 0.0


def construir(db: Session, anio: int) -> dict[str, Any]:
    semanas = _lunes(anio)
    primera = semanas[0] if semanas else dt.date(anio, 1, 1)
    hoy = dt.date.today()

    # ── TODAS las líneas de gasto del Job Cost. Sin filtro. ────────────────
    lineas = db.execute(
        text(
            """
            SELECT f.wbs_code, f.title, f.category, f.phase, f.owner, f.state,
                   f.budget_original, f.budget_change, f.budget_revised,
                   f.spend, f.remaining
            FROM v_wbs_financials f
            LEFT JOIN wbs_item w ON w.wbs_code = f.wbs_code
            WHERE f.kind = 'cost'
            ORDER BY COALESCE(f.category, 'zzz'), w.sort_order, f.wbs_code
            """
        )
    ).mappings().all()

    # ── El cronograma, partido en los tres tramos ──────────────────────────
    corte = db.execute(text("SELECT cutoff_date FROM settings LIMIT 1")).scalar()
    corte = corte or dt.date(anio - 1, 1, 1)
    plan: dict[str, dict[str, float]] = defaultdict(dict)
    vencido: dict[str, float] = defaultdict(float)
    arrastre: dict[str, float] = defaultdict(float)
    posterior: dict[str, float] = defaultdict(float)
    for r in db.execute(
        text(
            """
            SELECT w.wbs_code, s.week_start, SUM(s.planned_amount) AS monto
            FROM schedule_cell s JOIN wbs_item w ON w.id = s.wbs_id
            WHERE COALESCE(s.planned_amount, 0) <> 0
            GROUP BY 1, 2
            """
        )
    ).mappings():
        code, w, monto = r["wbs_code"], r["week_start"], _f(r["monto"])
        if isinstance(w, dt.datetime):
            w = w.date()
        if w.year == anio:
            plan[code][str(w)] = plan[code].get(str(w), 0.0) + monto
        elif w.year > anio:
            posterior[code] += monto
        elif w >= hoy:
            # Pendiente, anterior al año presupuestado. A medida que pasan
            # las semanas sin ejecutarse, cae al `vencido` de abajo: la plata no
            # se pierde, cambia de tramo. El 31-dic el arrastre llega a cero.
            arrastre[code] += monto
        elif w >= corte:
            vencido[code] += monto           # ⚠️ la semana ya pasó y sigue pendiente

    # ── El LEDGER, SOLO como dato al costado ───────────────────────────────
    desde = hoy - dt.timedelta(days=30 * MESES_DE_HISTORIAL)
    por_mes: dict[str, dict[str, float]] = defaultdict(dict)
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
        d: dt.date = r["entry_date"]
        ym = f"{d.year:04d}-{d.month:02d}"
        c = r["wbs_code"]
        por_mes[c][ym] = por_mes[c].get(ym, 0.0) + _f(r["monto"])

    ritmo: dict[str, float] = {}
    for c, meses in por_mes.items():
        if len(meses) >= MESES_MINIMOS:
            ritmo[c] = round(_mediana(list(meses.values())), 2)

    # ── Las filas: TODAS ───────────────────────────────────────────────────
    filas: list[dict[str, Any]] = []
    for ln in lineas:
        code = ln["wbs_code"]
        del_plan = plan.get(code, {})
        arr = round(arrastre.get(code, 0.0), 2)
        ven = round(vencido.get(code, 0.0), 2)
        propuesta = dict(del_plan)
        if arr or ven:
            # Lo que no pasó entra en la primera semana del año, a la vista,
            # para que alguien lo mueva a sabiendas en vez de que desaparezca.
            k = str(primera)
            propuesta[k] = round(propuesta.get(k, 0.0) + arr + ven, 2)
        filas.append(
            {
                "wbs_code": code,
                "title": ln["title"],
                "category": ln["category"] or "Sin categoría",
                "phase": ln["phase"],
                "owner": ln["owner"],
                "state": ln["state"],
                "budget_revised": round(_f(ln["budget_revised"]), 2),
                "spend": round(_f(ln["spend"]), 2),
                "remaining": round(_f(ln["remaining"]), 2),
                "vencido": ven,
                "arrastre": arr,
                "plan_total": round(sum(del_plan.values()), 2),
                "posterior": round(posterior.get(code, 0.0), 2),
                "plan": del_plan,
                "propuesta": propuesta,
                "propuesta_total": round(sum(propuesta.values()), 2),
                "ritmo_ledger": ritmo.get(code),
            }
        )

    suma = lambda k: round(sum(f[k] for f in filas), 2)  # noqa: E731
    tot_rem = suma("remaining")
    tot_cubierto = round(
        suma("vencido") + suma("arrastre") + suma("plan_total") + suma("posterior"), 2
    )
    return {
        "anio": anio,
        "semanas": [str(w) for w in semanas],
        "filas": filas,
        "totales": {
            "lineas": len(filas),
            "budget_revised": suma("budget_revised"),
            "spend": suma("spend"),
            "remanente": tot_rem,
            "vencido": suma("vencido"),
            "arrastre": suma("arrastre"),
            "plan": suma("plan_total"),
            "posterior": suma("posterior"),
            "propuesta": suma("propuesta_total"),
            # Si esto no es ~0, hay remanente que el cronograma no ubica en
            # ningún año — y entonces el presupuesto está incompleto.
            "sin_ubicar": round(tot_rem - tot_cubierto, 2),
        },
    }
