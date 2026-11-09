"""El tablero del inversionista: en qué termina esto, cómo viene y qué falta.

Owner, 2026-11-09: *«NO ME GUSTA EL DASHBOARD. NECESITO QUE HAGAS UNA
INVESTIGACIÓN EN LA INDUSTRIA DE DESARROLLO DE PROPIEDADES... CUÁLES SON LOS
INDICADORES CLAVES DE UN INVERSOR DE BIENES RAÍCES CON RESPECTO A CÓMO VA SU
PROYECTO»* · *«DEBEN HABER LEADS INDICATOR»*.

## Qué estaba mal con el anterior

Los diez KPI de la pantalla vieja eran **todos rezagados**: contaban lo que ya
había pasado. Ninguno avisaba de nada antes de que ocurriera. Y la tarjeta
«Budget Revised $21,040,443» escondía lo más importante que tiene este proyecto
para contar: ese número arrancó en $15,726,007 y creció **33.8%**.

## Lo que la industria mira, en este orden

1. **Anticipated Final Cost** = pagado + comprometido sin pagar + remanente sin
   comprometer. Es *la* pregunta: ¿en cuánto termina esto? El formato estándar
   —el Anticipated Cost Report— tiene una columna que este sistema no tenía:
   **comprometido**. La diferencia entre «gasté» y «ya me obligué a gastar» es
   la que convierte un reporte histórico en uno que mira hacia adelante.
2. **Profit on Cost / Yield on Cost.** ⚠️ NO se calculan acá y es a propósito:
   el sistema no guarda el valor esperado del proyecto (GDV). Hay $21M de costo
   contra una sola línea de venta por $480,000 sin realizar. Decisión del owner
   el 2026-11-09: *«solo el costo, por ahora»*. Cuando entre el GDV, el margen
   se calcula contra `anticipated_final_cost` y nada más cambia.
3. **La curva S** — planeado contra real acumulado.
4. **Cost to Complete**, partido en comprometido y sin comprometer.

## Los indicadores ADELANTADOS, que es lo que se pidió

Un indicador adelantado avisa ANTES de que el costo aparezca. Los cinco que
este proyecto puede sostener hoy, medidos contra producción:

| | Qué avisa | Al 2026-11-09 |
|---|---|---|
| Exposición sin contrato | el remanente sin precio firmado | **96.1%** de $6.7M |
| Crecimiento del presupuesto | cuánto se ha corrido la meta | **+33.8%** |
| Contingencia consumida vs avance | si el sobrecosto ya está decidido | no hay reserva |
| Líneas en Attention | lo que el equipo ya marcó | 12 líneas |
| Efectivo contra 90 días | el llamado de capital que viene | faltan **$1.8M** |

⚠️ **La contingencia se lee, no se inventa.** Si nadie creó una línea marcada
`is_contingency`, el tablero lo dice en ámbar en vez de suponer un porcentaje.
Cuánto reservar es una decisión de plata y no le toca al código tomarla.

⚠️ **La curva S sale de `entry_date`, no de `date_paid`.** `date_paid` cubre el
2.2% del dinero (55 de 286 filas) y `entry_date` el 100%. Dibujarla con
`date_paid` habría mostrado un proyecto que gastó $312,259 de $14,313,437 —una
curva plana y falsa— sin que nada avisara del hueco.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

# Cuántos días hacia adelante cuenta el «llamado de capital». 90 es el horizonte
# con el que se mueve una obra: lo que hay que girar antes del próximo trimestre.
DIAS_CAJA = 90


def _f(x: Any) -> float:
    return float(x or 0)


def _r(x: Any) -> float:
    return round(_f(x), 2)


def construir(db: Session, dias: int = DIAS_CAJA) -> dict[str, Any]:
    hoy = dt.date.today()

    # ── Las líneas, con lo comprometido ───────────────────────────────────
    filas = db.execute(
        text(
            """
            SELECT f.wbs_code, f.title, f.category, f.phase, f.owner, f.kind,
                   f.state, f.is_contingency,
                   f.budget_original, f.budget_change, f.budget_revised,
                   f.spend, f.committed, f.remaining, f.forecast,
                   ts.label AS state_label
              FROM v_wbs_financials f
              LEFT JOIN wbs_item w ON w.wbs_code = f.wbs_code
              LEFT JOIN task_state ts ON ts.id = w.state_id
             WHERE f.kind <> 'section_header'
             ORDER BY COALESCE(f.category, 'zzz'), w.sort_order, f.wbs_code
            """
        )
    ).mappings().all()

    costo = [r for r in filas if r["kind"] != "proceeds"]
    venta = [r for r in filas if r["kind"] == "proceeds"]

    def suma(rs: list[Any], k: str) -> float:
        return round(sum(_f(r[k]) for r in rs), 2)

    bo = suma(costo, "budget_original")
    bc = suma(costo, "budget_change")
    br = suma(costo, "budget_revised")
    pagado = suma(costo, "spend")
    comprometido = suma(costo, "committed")
    remanente = suma(costo, "remaining")

    # Comprometido pero todavía sin pagar. Es plata que ya no se puede evitar.
    por_pagar = round(max(comprometido - pagado, 0.0), 2)
    # Y lo que falta sin contrato: expuesto a que el precio cambie.
    sin_comprometer = round(remanente - por_pagar, 2)

    # ⚠️ El Anticipated Final Cost sale de los TRES tramos, no de `forecast`.
    # `forecast` usa el cronograma y por eso da lo mismo que el presupuesto
    # revisado cuando el cronograma está cuadrado; este número se mueve con lo
    # que de verdad está comprometido.
    eac = round(pagado + por_pagar + sin_comprometer, 2)

    # ── La contingencia, si alguien la creó ───────────────────────────────
    cont = [r for r in costo if r["is_contingency"]]
    contingencia = {
        "existe": bool(cont),
        "lineas": len(cont),
        "presupuesto": suma(cont, "budget_revised"),
        "consumida": suma(cont, "spend"),
        "queda": suma(cont, "remaining"),
    }

    # ── El avance, por costo y por hito ───────────────────────────────────
    # Por costo es un proxy y la industria avisa de eso: el dinero no avanza al
    # mismo ritmo que la obra. Por eso van los dos, y el de hito pesa cada línea
    # por su presupuesto en vez de contarlas de a una.
    pct_costo = round(100 * pagado / br, 2) if br else 0.0
    por_estado: dict[str, dict[str, Any]] = {}
    for r in costo:
        k = r["state_label"] or "—"
        e = por_estado.setdefault(k, {"estado": k, "lineas": 0, "presupuesto": 0.0, "gastado": 0.0})
        e["lineas"] += 1
        e["presupuesto"] = round(e["presupuesto"] + _f(r["budget_revised"]), 2)
        e["gastado"] = round(e["gastado"] + _f(r["spend"]), 2)
    completo = sum(e["presupuesto"] for k, e in por_estado.items() if k.lower() == "completed")
    pct_hito = round(100 * completo / br, 2) if br else 0.0

    # ── Lo que el equipo ya marcó ────────────────────────────────────────
    atencion = [
        {
            "wbs_code": r["wbs_code"],
            "title": r["title"],
            "category": r["category"],
            "budget_revised": _r(r["budget_revised"]),
            "spend": _r(r["spend"]),
            "remaining": _r(r["remaining"]),
        }
        for r in costo
        if (r["state"] or "") == "attention"
    ]
    atencion.sort(key=lambda x: -x["remaining"])

    # ── La curva S ────────────────────────────────────────────────────────
    # Real: el LEDGER por `entry_date`. Plan: el cronograma por semana. Las dos
    # acumuladas, por mes, para que se vea el adelanto o el atraso.
    real = {
        str(r[0]): _r(r[1])
        for r in db.execute(
            text(
                """
                SELECT to_char(NULLIF(entry_date,'')::date, 'YYYY-MM') AS mes,
                       SUM(amount_paid)
                  FROM ledger_sheet_row
                 WHERE kind = 'data'
                   AND entry_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                 GROUP BY 1
                """
            )
        ).all()
    }
    plan = {
        str(r[0]): _r(r[1])
        for r in db.execute(
            text(
                """
                SELECT to_char(week_start, 'YYYY-MM') AS mes, SUM(planned_amount)
                  FROM schedule_cell
                 WHERE COALESCE(planned_amount, 0) <> 0
                 GROUP BY 1
                """
            )
        ).all()
    }
    meses = sorted(set(real) | set(plan))
    curva: list[dict[str, Any]] = []
    ap = ar = 0.0
    hoy_mes = hoy.strftime("%Y-%m")
    for m in meses:
        ap = round(ap + plan.get(m, 0.0), 2)
        ar = round(ar + real.get(m, 0.0), 2)
        curva.append(
            {
                "mes": m,
                "plan": plan.get(m, 0.0),
                "real": real.get(m, 0.0),
                "plan_acum": ap,
                # ⚠️ El acumulado real se corta en el mes corriente. Seguir la
                # línea hacia el futuro la dibujaría plana y daría a entender
                # que el gasto se detuvo, cuando lo que pasa es que todavía no
                # ocurrió.
                "real_acum": ar if m <= hoy_mes else None,
            }
        )

    # ── La caja: lo que hay y lo que el cronograma pide ───────────────────
    efectivo = _r(
        db.execute(
            text(
                """
                SELECT COALESCE(SUM(s.closing_balance), 0)
                  FROM bank_account a
                  LEFT JOIN LATERAL (
                      SELECT closing_balance FROM bank_statement
                       WHERE account_id = a.id ORDER BY period_to DESC LIMIT 1
                  ) s ON TRUE
                 WHERE a.is_active AND a.currency = 'USD'
                """
            )
        ).scalar()
    )
    pide_90 = _r(
        db.execute(
            text(
                """
                SELECT COALESCE(SUM(planned_amount), 0)
                  FROM schedule_cell
                 WHERE COALESCE(planned_amount, 0) <> 0
                   AND week_start >= :hoy AND week_start < :hasta
                """
            ),
            {"hoy": hoy, "hasta": hoy + dt.timedelta(days=dias)},
        ).scalar()
    )
    aporte = _r(
        db.execute(
            text("SELECT COALESCE(SUM(amount_received), 0) FROM us_wire_row")
        ).scalar()
    )

    # Lo que el cronograma pide por trimestre, de hoy en adelante.
    llamados = [
        {"desde": str(r[0]), "monto": _r(r[1])}
        for r in db.execute(
            text(
                """
                SELECT date_trunc('quarter', week_start)::date AS q,
                       SUM(planned_amount)
                  FROM schedule_cell
                 WHERE COALESCE(planned_amount, 0) <> 0 AND week_start >= :hoy
                 GROUP BY 1 ORDER BY 1
                """
            ),
            {"hoy": hoy},
        ).all()
    ]

    # ── Pendiente por sección, partido en comprometido y sin comprometer ──
    secciones: dict[str, dict[str, Any]] = {}
    for r in costo:
        k = r["category"] or "—"
        s = secciones.setdefault(
            k,
            {
                "category": k, "lineas": 0, "budget_revised": 0.0, "spend": 0.0,
                "committed": 0.0, "remaining": 0.0,
            },
        )
        s["lineas"] += 1
        for campo, col in (
            ("budget_revised", "budget_revised"), ("spend", "spend"),
            ("committed", "committed"), ("remaining", "remaining"),
        ):
            s[campo] = round(s[campo] + _f(r[col]), 2)
    for s in secciones.values():
        s["por_pagar"] = round(max(s["committed"] - s["spend"], 0.0), 2)
        s["sin_comprometer"] = round(s["remaining"] - s["por_pagar"], 2)
        s["pct"] = round(100 * s["spend"] / s["budget_revised"], 1) if s["budget_revised"] else 0.0

    # ── Los permisos, que en un proyecto desde cero son la compuerta ──────
    permisos = [
        {
            "wbs_code": r["wbs_code"], "title": r["title"],
            "state": r["state_label"], "budget_revised": _r(r["budget_revised"]),
            "spend": _r(r["spend"]),
        }
        for r in costo
        if any(
            p in (str(r["title"]) or "").lower()
            for p in ("permit", "setena", "cfia", "approval", "cadastre", "municipality")
        )
    ]

    return {
        "fecha": str(hoy),
        "dias_caja": dias,
        # ── 1 · ¿En qué termina esto? ─────────────────────────────────────
        "costo": {
            "budget_original": bo,
            "budget_change": bc,
            "budget_revised": br,
            "crecimiento_pct": round(100 * bc / bo, 2) if bo else 0.0,
            "pagado": pagado,
            "comprometido": comprometido,
            "por_pagar": por_pagar,
            "sin_comprometer": sin_comprometer,
            "remanente": remanente,
            "anticipated_final_cost": eac,
            # Contra el original, que es contra lo que se aprobó el proyecto.
            "variacion_vs_original": round(eac - bo, 2),
        },
        # ── 2 · Señales que avisan antes ──────────────────────────────────
        "adelantados": {
            "exposicion_sin_contrato_pct": (
                round(100 * sin_comprometer / remanente, 1) if remanente else 0.0
            ),
            "exposicion_sin_contrato": sin_comprometer,
            "crecimiento_presupuesto_pct": round(100 * bc / bo, 2) if bo else 0.0,
            "contingencia": contingencia,
            "atencion_lineas": len(atencion),
            "atencion_remanente": round(sum(x["remaining"] for x in atencion), 2),
            "caja_hoy": efectivo,
            "caja_pide_90": pide_90,
            "caja_faltante": round(max(pide_90 - efectivo, 0.0), 2),
        },
        # ── 3 · Avance ────────────────────────────────────────────────────
        "avance": {
            "pct_por_costo": pct_costo,
            "pct_por_hito": pct_hito,
            "por_estado": sorted(por_estado.values(), key=lambda e: -e["presupuesto"]),
            "curva": curva,
        },
        # ── 4 · Pendiente ─────────────────────────────────────────────────
        "pendiente": {
            "secciones": sorted(secciones.values(), key=lambda s: -s["remaining"]),
            "llamados": llamados,
            "permisos": permisos,
            "atencion": atencion,
        },
        # ── Al margen: la plata de los dueños y la venta ──────────────────
        "aporte_duenos": aporte,
        "venta": [
            {
                "wbs_code": r["wbs_code"], "title": r["title"],
                "esperado": _r(r["budget_revised"]), "realizado": _r(r["spend"]),
            }
            for r in venta
        ],
    }
