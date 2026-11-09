"""El puente del saldo bancario: del banco a lo que el sistema sabe.

Owner, 2026-11-09: *«Necesito hacer una conciliacion del Banco. pegar el saldo
del banco con los short payments solicitados y no pagados, con los ingresos de
intereses no registrados y los gastos por intereses no registrados... arma algo
primero para ver como se pega el saldo del banco»*.

## Qué es esto y qué NO es

Es un **puente de saldo**, no un cuadre línea por línea. El tab «Bank
Reconciliation» que ya existe compara el extracto contra el LEDGER movimiento a
movimiento; esto arranca del saldo que informa el banco y va restando y sumando
hasta llegar a lo que el sistema tiene registrado, dejando a la vista cada
partida que explica la diferencia.

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

⚠️ El Dashboard tomaba el extracto y por eso muestra $49,673.41 — $1,463.65 de
más. Está corregido en `tablero.py` junto con este cambio.

## Por qué cada partida lleva una marca de confianza

Tres de las cuatro partidas que pidió el owner resultaron ser, al medirlas,
**huecos de carga y no obligaciones reales**:

* los 25 Short Payments «pedidos y no pagados» arrancan en **diciembre de 2024**
  y ninguno aparece en el LEDGER. Con $14.3M pagados en el proyecto, lo que pasó
  es que el flujo de estados nunca pasó de `draft`;
* los pagos a proveedor «sin fila en el LEDGER» incluyen los $10.4M de la cuenta
  #1, que son los giros de los dueños vistos desde el otro lado;
* los intereses y comisiones sí son reales, pero suman $1,455 contra un saldo de
  $48 mil: mueven la tercera cifra decimal del proyecto, no el proyecto.

Un puente que presentara las cuatro como equivalentes diría que faltan $3.5
millones. Por eso cada partida viaja con `confianza` y el frontend las separa:
mezclarlas es cómo se arma un número que asusta y que nadie puede usar.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session


def _f(x: Any) -> float:
    return round(float(x or 0), 2)


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

    # ── Short Payments pedidos y todavía sin marcar como pagados ──────────
    tandas = [
        {
            "status": r["status"],
            "disb": f"{r['disb_no']}.{r['disb_sub']}",
            "mes": str(r["period_month"]) if r["period_month"] else None,
            "monto": _f(r["total_amount"]),
            # ⚠️ Si no hay NADA en el LEDGER que cite esta tanda, es señal de que
            # el estado se quedó en `draft` y no de que el dinero esté pendiente.
            "en_ledger": _f(r["en_ledger"]),
        }
        for r in db.execute(
            text(
                """
                SELECT d.status, d.disb_no, d.disb_sub, d.period_month, d.total_amount,
                       (SELECT COALESCE(SUM(l.amount_paid), 0)
                          FROM ledger_sheet_row l
                         WHERE l.kind = 'data'
                           AND l.description ILIKE '%Disbursement #'
                               || d.disb_no || '%') AS en_ledger
                  FROM disbursement d
                 WHERE d.status IN ('draft', 'submitted')
                 ORDER BY d.disb_no, d.disb_sub
                """
            )
        ).mappings()
    ]
    pedido = round(sum(t["monto"] for t in tandas), 2)
    # Las que además son VIEJAS: pedidas antes del mes pasado y sin rastro en el
    # LEDGER. Son las que casi seguro ya se pagaron y nadie cerró el estado.
    corte = dt.date.today().replace(day=1) - dt.timedelta(days=1)
    viejas = [
        t for t in tandas
        if t["en_ledger"] < 0.5 and t["mes"] and t["mes"] <= str(corte)
    ]
    pedido_viejo = round(sum(t["monto"] for t in viejas), 2)

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
    # `confianza`:
    #   "dato"   el banco lo informa y está medido: se puede usar tal cual
    #   "hueco"  casi seguro es carga incompleta, no una obligación real
    partidas: list[dict[str, Any]] = [
        {
            "etq": "Interest earned, not in the LEDGER",
            "monto": -intereses,
            "n": sum(v["n"] for v in mov.values() if v["es_ingreso"]),
            "confianza": "dato",
            "nota": "The bank credited it; the LEDGER has no row for it.",
        },
        {
            "etq": "Bank charges and fees, not in the LEDGER",
            "monto": cargos,
            "n": sum(v["n"] for v in mov.values() if v["es_cargo"]),
            "confianza": "dato",
            "nota": "Transfer fees and admin charges the LEDGER never recorded.",
        },
        {
            "etq": "Short Payments requested, not marked paid",
            "monto": -pedido,
            "n": len(tandas),
            "confianza": "hueco",
            "nota": (
                f"{len(viejas)} of the {len(tandas)} batches "
                f"({_f(pedido_viejo)}) are from before last month and have no trace "
                "in the LEDGER. With $14.3M paid on the project, that is a status "
                "that never moved past «draft», not money still owed."
            ),
        },
    ]

    return {
        "fecha": str(dt.date.today()),
        "cuentas": cuentas,
        "saldo_banco": saldo,
        # ⚠️ Lo que diría el tablero si tomara el extracto en vez del último
        # movimiento. Se expone para que la diferencia se vea, no se adivine.
        "saldo_por_extracto": round(sum(c["saldo_extracto"] for c in cuentas), 2),
        "partidas": partidas,
        "intereses": intereses,
        "cargos": cargos,
        "pedido": pedido,
        "pedido_viejo": pedido_viejo,
        "tandas": tandas,
        "sin_ledger": sin_ledger,
        "mov": mov,
        # El saldo contando SOLO las partidas que son dato duro.
        "saldo_ajustado": round(
            saldo
            + sum(p["monto"] for p in partidas if p["confianza"] == "dato"),
            2,
        ),
        # Y el que saldría contando todo, para mostrar la diferencia entre
        # «lo que el banco dice» y «lo que el sistema cree».
        "saldo_si_todo_cuenta": round(
            saldo + sum(p["monto"] for p in partidas), 2
        ),
    }
