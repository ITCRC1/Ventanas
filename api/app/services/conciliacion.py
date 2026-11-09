"""El puente del saldo bancario: del banco a lo que el LEDGER dice que falta pagar.

Owner, 2026-11-09: *«Necesito hacer una conciliacion del Banco. pegar el saldo
del banco con los short payments solicitados y no pagados, con los ingresos de
intereses no registrados y los gastos por intereses no registrados»*.

## ⚠️ El pendiente sale del LEDGER, no de `disbursement`

Owner, 2026-11-09: *«lo que esta en el ledger no se puede tocar»* · *«es lo que
realmente paso»* · *«el ledger muestra lo solicitado y lo pagado y la
diferencia.. solo hay que tomar en cuenta esas cosas que no se han pagado»*.

El LEDGER **ya trae las tres columnas**: `amount` (lo solicitado), `amount_paid`
(lo pagado), y la diferencia es el pendiente. No hay nada que deducir ni que
corregir — es el registro de lo que pasó.

    solicitado  14,573,161.72
    pagado      14,313,437.35
    pendiente      259,724.37   ← esto es lo que va al puente

La primera versión de este archivo tomaba el pendiente de la tabla
`disbursement`, contando las tandas que seguían en `draft`, y daba
**$3,585,878** — casi catorce veces de más. Ese número no era una obligación:
era un estado que nadie cerró. La tabla `disbursement` es la **solicitud**; el
LEDGER es el **hecho**. Para saber qué falta pagar se mira el hecho.

⚠️ Por lo mismo, este módulo **no toca** `ledger_sheet_row` ni propone
correcciones sobre él. Solo lee.

## ⚠️ El saldo sale del ÚLTIMO MOVIMIENTO, no del extracto

La cuenta operativa tiene DOS extractos con `period_to = 2026-11-06`: el #3
declara $49,673.41 y el #4 declara $48,209.76. Los dos son correctos para lo que
cada uno contiene — el #3 termina en el movimiento del 11-05 y el #4 trae tres
más del 11-06:

    49,673.41  (último movimiento del extracto #3, 2026-11-05)
      − 186.90  FERRETERIA Y VETERINARIOS
      −   4.00  Comisión por transferencia
      − 1,272.75  PAGO FC #15706-15528
    = 48,209.76

Tomar «el extracto más reciente por `period_to`» desempata al azar entre los
dos. Por eso acá el saldo sale del **último `balance` que informó el banco en
`bank_tx`**, que es el dato que el banco mismo pone en cada línea.

⚠️ El Dashboard tomaba el extracto y por eso mostraba $49,673.41 — $1,463.65 de
más. Está corregido en `tablero.py` junto con este cambio.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


def _f(x: Any) -> float:
    return round(float(x or 0), 2)


# El pendiente de una fila del LEDGER: lo solicitado menos lo pagado. Se repite
# en varias consultas, así que vive en un solo lugar.
_PEND = "COALESCE(amount, 0) - COALESCE(amount_paid, 0)"


def construir(db: Session) -> dict[str, Any]:
    # ── El saldo de cada cuenta, del último movimiento ────────────────────
    cuentas = [
        {
            "id": r["id"],
            "nombre": r["name"],
            "moneda": r["currency"],
            "fecha": str(r["tx_date"]) if r["tx_date"] else None,
            "saldo": _f(r["balance"]),
            # Lo que diría si se tomara el extracto, para poder contrastar.
            "saldo_extracto": _f(r["closing_balance"]),
            "extracto_fecha": str(r["period_to"]) if r["period_to"] else None,
        }
        for r in db.execute(
            text(
                """
                SELECT a.id, a.name, a.currency, t.tx_date, t.balance,
                       s.closing_balance, s.period_to
                  FROM bank_account a
                  LEFT JOIN LATERAL (
                      SELECT tx_date, balance FROM bank_tx
                       WHERE account_id = a.id AND balance IS NOT NULL
                       ORDER BY tx_date DESC, id DESC LIMIT 1
                  ) t ON TRUE
                  LEFT JOIN LATERAL (
                      SELECT closing_balance, period_to FROM bank_statement
                       WHERE account_id = a.id ORDER BY period_to DESC, id DESC LIMIT 1
                  ) s ON TRUE
                 WHERE a.is_active
                 ORDER BY a.id
                """
            )
        ).mappings()
    ]
    saldo = round(sum(c["saldo"] for c in cuentas), 2)

    # ── Intereses y cargos: lo que el banco movió y el LEDGER no registra ──
    mov = {
        r["code"]: {
            "label": r["label"],
            "es_cargo": r["is_charge"],
            "es_ingreso": r["is_income"],
            "n": r["n"],
            "credito": _f(r["cre"]),
            "debito": _f(r["deb"]),
        }
        for r in db.execute(
            text(
                """
                SELECT k.code, k.label, k.is_charge, k.is_income,
                       COUNT(t.id) AS n,
                       COALESCE(SUM(t.credit), 0) AS cre,
                       COALESCE(SUM(t.debit), 0)  AS deb
                  FROM bank_movement_class k
                  LEFT JOIN bank_tx t ON t.class_code = k.code
                 WHERE k.is_charge OR k.is_income
                 GROUP BY 1, 2, 3, 4
                 ORDER BY 1
                """
            )
        ).mappings()
    }
    intereses = round(sum(v["credito"] for v in mov.values() if v["es_ingreso"]), 2)
    cargos = round(sum(v["debito"] for v in mov.values() if v["es_cargo"]), 2)

    # ── Lo solicitado y no pagado, tal como lo trae el LEDGER ─────────────
    totales = (
        db.execute(
            text(
                f"""
                SELECT COUNT(*) AS filas,
                       COALESCE(SUM(COALESCE(amount, 0)), 0)      AS solicitado,
                       COALESCE(SUM(COALESCE(amount_paid, 0)), 0) AS pagado,
                       COALESCE(SUM({_PEND}), 0)                  AS diferencia
                  FROM ledger_sheet_row
                 WHERE kind = 'data'
                """
            )
        )
        .mappings()
        .one()
    )

    # Las filas que todavía tienen saldo. Se listan enteras: son 35 y el owner
    # necesita verlas, no un total que haya que creer.
    sin_pagar = [
        {
            "wbs": r["cost_code"],
            "fecha": r["entry_date"],
            "beneficiario": r["payee"],
            "descripcion": r["description"],
            "solicitado": _f(r["amount"]),
            "pagado": _f(r["amount_paid"]),
            "pendiente": _f(r["pendiente"]),
        }
        for r in db.execute(
            text(
                f"""
                SELECT cost_code, entry_date, payee, description,
                       amount, amount_paid, {_PEND} AS pendiente
                  FROM ledger_sheet_row
                 WHERE kind = 'data' AND {_PEND} > 0.5
                 ORDER BY {_PEND} DESC
                """
            )
        ).mappings()
    ]
    pendiente = round(sum(f["pendiente"] for f in sin_pagar), 2)

    # Por año, para que se vea de cuándo viene el saldo.
    por_anio = [
        {
            "anio": r["anio"],
            "filas": r["filas"],
            "solicitado": _f(r["solicitado"]),
            "pagado": _f(r["pagado"]),
            "pendiente": _f(r["pendiente"]),
        }
        for r in db.execute(
            text(
                f"""
                SELECT LEFT(entry_date, 4) AS anio, COUNT(*) AS filas,
                       COALESCE(SUM(COALESCE(amount, 0)), 0)      AS solicitado,
                       COALESCE(SUM(COALESCE(amount_paid, 0)), 0) AS pagado,
                       COALESCE(SUM({_PEND}), 0)                  AS pendiente
                  FROM ledger_sheet_row
                 WHERE kind = 'data' AND {_PEND} > 0.5
                 GROUP BY 1 ORDER BY 1
                """
            )
        ).mappings()
    ]

    # ⚠️ Y lo contrario: filas donde se pagó MÁS de lo solicitado. Son dos y
    # suman $54.01, pero si no se muestran el puente no cierra al centavo.
    de_mas = [
        {
            "wbs": r["cost_code"],
            "fecha": r["entry_date"],
            "beneficiario": r["payee"],
            "solicitado": _f(r["amount"]),
            "pagado": _f(r["amount_paid"]),
            "de_mas": _f(r["de_mas"]),
        }
        for r in db.execute(
            text(
                """
                SELECT cost_code, entry_date, payee, amount, amount_paid,
                       COALESCE(amount_paid, 0) - COALESCE(amount, 0) AS de_mas
                  FROM ledger_sheet_row
                 WHERE kind = 'data'
                   AND COALESCE(amount_paid, 0) - COALESCE(amount, 0) > 0.5
                 ORDER BY 6 DESC
                """
            )
        ).mappings()
    ]
    pagado_de_mas = round(sum(f["de_mas"] for f in de_mas), 2)

    # ── Pagos del banco sin fila en el LEDGER ─────────────────────────────
    sin_ledger = [
        {
            "cuenta": r["account_id"],
            "nombre": r["name"],
            "n": r["n"],
            "monto": _f(r["monto"]),
        }
        for r in db.execute(
            text(
                """
                SELECT t.account_id, a.name, COUNT(*) AS n,
                       COALESCE(SUM(t.debit), 0) AS monto
                  FROM bank_tx t
                  JOIN bank_account a ON a.id = t.account_id
                  LEFT JOIN bank_movement_class k ON k.code = t.class_code
                 WHERE t.recon_sheet_row_id IS NULL
                   AND t.reconciled_ledger_id IS NULL
                   AND COALESCE(t.debit, 0) > 0
                   AND NOT COALESCE(k.is_charge, false)
                 GROUP BY 1, 2 ORDER BY 1
                """
            )
        ).mappings()
    ]

    # ── El puente, partida por partida ────────────────────────────────────
    #
    # Las dos primeras son del banco: plata que ya se movió y el LEDGER no tiene.
    # Las dos últimas son del LEDGER: plata que todavía no se movió.
    banco: list[dict[str, Any]] = [
        {
            "etq": "Interest earned, not in the LEDGER",
            "monto": -intereses,
            "n": sum(v["n"] for v in mov.values() if v["es_ingreso"]),
            "nota": "The bank credited it; the LEDGER has no row for it.",
        },
        {
            "etq": "Bank charges and fees, not in the LEDGER",
            "monto": cargos,
            "n": sum(v["n"] for v in mov.values() if v["es_cargo"]),
            "nota": "Transfer fees and admin charges the LEDGER never recorded.",
        },
    ]
    compromisos: list[dict[str, Any]] = [
        {
            "etq": "Requested and not paid, per the LEDGER",
            "monto": pendiente,
            "n": len(sin_pagar),
            "nota": (
                "Amount minus Amount Paid on every LEDGER row that still has a "
                "balance. This is the record of what happened, not an estimate."
            ),
        }
    ]
    if de_mas:
        compromisos.append(
            {
                "etq": "Paid over the amount requested",
                "monto": -pagado_de_mas,
                "n": len(de_mas),
                "nota": "Rows where Amount Paid came in above Amount.",
            }
        )

    ajustado = round(saldo - intereses + cargos, 2)
    return {
        "fecha": str(dt.date.today()),
        "cuentas": cuentas,
        "saldo_banco": saldo,
        # ⚠️ Lo que diría el tablero si tomara el extracto en vez del último
        # movimiento. Se expone para que la diferencia se vea, no se adivine.
        "saldo_por_extracto": round(sum(c["saldo_extracto"] for c in cuentas), 2),
        "banco": banco,
        "compromisos": compromisos,
        "intereses": intereses,
        "cargos": cargos,
        # Los tres totales del LEDGER, para poder cuadrarlo contra la hoja.
        "ledger": {
            "filas": totales["filas"],
            "solicitado": _f(totales["solicitado"]),
            "pagado": _f(totales["pagado"]),
            "diferencia": _f(totales["diferencia"]),
        },
        "pendiente": pendiente,
        "pagado_de_mas": pagado_de_mas,
        "sin_pagar": sin_pagar,
        "por_anio": por_anio,
        "de_mas": de_mas,
        "sin_ledger": sin_ledger,
        "mov": mov,
        # El saldo después de lo que el banco ya movió y el LEDGER no registra.
        "saldo_ajustado": ajustado,
        # Y después de descontar lo que falta pagar. Puede dar NEGATIVO: el
        # proyecto debe más de lo que tiene en el banco, y eso es el dato.
        "saldo_tras_pendiente": round(ajustado - pendiente + pagado_de_mas, 2),
    }
