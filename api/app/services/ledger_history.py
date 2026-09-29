"""Historial del cronograma derivado del LEDGER — el ledger prevalece.

Las semanas anteriores al Forecast cut-off son HISTORIA: tienen que reproducir lo
que el LEDGER dice que se pagó, no pintura a mano. La app ya las bloquea diciendo
"history from the ledger", pero nada las llenaba desde ahí; el desfase aparece
como saldo en la columna Control (Control = Spend − pintado antes del corte).

Esto arma ese historial por línea y lo compara con lo pintado. Aplicar reescribe
SOLO las semanas anteriores al corte, poniendo cada pago en la semana de su fecha.

**No inventa nada.** Un pago sin fecha no se puede ubicar en ninguna semana, así
que esa línea queda intacta y se reporta (regla "No inventar datos" de CLAUDE.md).
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Any, NamedTuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.db import set_audit_batch

# Tolerancia: por debajo de medio centavo es ruido de redondeo, no un desfase.
CENTAVO = Decimal("0.005")

NOTA = "Historial traido del LEDGER"


class Pago(NamedTuple):
    """Un pago del LEDGER que cuelga de una línea (ledger_sheet_row)."""

    cost_code: str
    entry_date: date | None
    amount_paid: Decimal


class Linea(NamedTuple):
    wbs_id: int
    wbs_code: str
    title: str


def monday(d: date) -> date:
    """Lunes de la semana del pago. La base exige que week_start sea lunes."""
    return d - timedelta(days=d.weekday())


def build_plan(
    lineas: list[Linea],
    pagos: list[Pago],
    pintado: dict[int, dict[date, Decimal]],
    corte: date,
) -> list[dict[str, Any]]:
    """Función pura: qué debería quedar pintado en cada línea, según el ledger.

    `pintado` es lo que hay hoy ANTES del corte: {wbs_id: {semana: monto}}.
    Devuelve una fila por línea con el diagnóstico y las celdas propuestas.
    """
    por_codigo: dict[str, list[Pago]] = {}
    for p in pagos:
        por_codigo.setdefault(p.cost_code, []).append(p)

    salida: list[dict[str, Any]] = []
    for ln in lineas:
        mios = por_codigo.get(ln.wbs_code, [])
        actual = pintado.get(ln.wbs_id, {})
        actual_total = sum(actual.values(), Decimal(0))

        spend = sum((p.amount_paid for p in mios), Decimal(0))
        sin_fecha = [p for p in mios if p.entry_date is None]
        monto_sin_fecha = sum((p.amount_paid for p in sin_fecha), Decimal(0))

        # Ubicables: los que tienen fecha y cuya semana cae antes del corte.
        nuevas: dict[date, Decimal] = {}
        tarde = Decimal(0)
        for p in mios:
            if p.entry_date is None:
                continue
            wk = monday(p.entry_date)
            if wk >= corte:
                tarde += p.amount_paid  # pagado, pero su semana ya es "futuro"
                continue
            nuevas[wk] = nuevas.get(wk, Decimal(0)) + p.amount_paid
        nuevo_total = sum(nuevas.values(), Decimal(0))

        igual = all(
            abs(nuevas.get(w, Decimal(0)) - actual.get(w, Decimal(0))) <= CENTAVO
            for w in set(nuevas) | set(actual)
        )
        if sin_fecha:
            estado = "sin_fecha"
            nota = (
                f"{len(sin_fecha)} pago(s) sin fecha por {monto_sin_fecha:,.2f}: "
                "no se pueden ubicar en ninguna semana. La linea queda intacta."
            )
        elif igual:
            estado = "sin_cambios"
            nota = "El historial pintado ya coincide con el ledger."
        else:
            estado = "reconstruir"
            nota = ""
            if tarde > CENTAVO:
                nota = (
                    f"Quedan {tarde:,.2f} pagados con fecha POSTERIOR al corte: "
                    "no entran en el historial. Corre el corte hacia adelante."
                )

        salida.append(
            {
                "wbs_id": ln.wbs_id,
                "wbs_code": ln.wbs_code,
                "title": ln.title,
                "estado": estado,
                "spend": spend,
                "pintado_actual": actual_total,
                "pintado_nuevo": nuevo_total,
                "diferencia": nuevo_total - actual_total,
                "celdas_actuales": len(actual),
                "celdas_nuevas": len(nuevas),
                "monto_sin_fecha": monto_sin_fecha,
                "pagado_despues_del_corte": tarde,
                "nota": nota,
                "_celdas": nuevas,  # solo para aplicar; no sale por la API
            }
        )
    return salida


def _fetch(
    db: Session, corte: date
) -> tuple[list[Linea], list[Pago], dict[int, dict[date, Decimal]]]:
    lineas = [
        Linea(r.id, r.wbs_code, r.title or "")
        for r in db.execute(
            text(
                "SELECT id, wbs_code, title FROM wbs_item "
                "WHERE is_active AND kind = 'cost' ORDER BY wbs_code"
            )
        )
    ]
    pagos = [
        Pago(r.cost_code, r.entry_date, Decimal(str(r.amount_paid)))
        for r in db.execute(
            text(
                # entry_date es TEXTO en la hoja: solo se toma el ISO. Cualquier
                # otro formato cuenta como "sin fecha" y bloquea la linea.
                r"SELECT cost_code, "
                r"       CASE WHEN TRIM(entry_date) ~ '^\d{4}-\d{2}-\d{2}$' "
                r"            THEN TRIM(entry_date)::date END AS entry_date, "
                r"       amount_paid "
                r"FROM ledger_sheet_row "
                r"WHERE kind = 'data' AND COALESCE(amount_paid, 0) <> 0 "
                r"  AND NULLIF(TRIM(COALESCE(cost_code, '')), '') IS NOT NULL"
            )
        )
    ]
    pintado: dict[int, dict[date, Decimal]] = {}
    for r in db.execute(
        text(
            "SELECT wbs_id, week_start, planned_amount FROM schedule_cell "
            "WHERE week_start < :c AND COALESCE(planned_amount, 0) <> 0"
        ),
        {"c": corte},
    ):
        pintado.setdefault(r.wbs_id, {})[r.week_start] = Decimal(str(r.planned_amount))
    return lineas, pagos, pintado


def _cutoff(db: Session) -> date:
    corte = db.execute(text("SELECT cutoff_date FROM settings LIMIT 1")).scalar()
    if corte is None:
        raise ValueError("No hay Forecast cut-off definido en settings.")
    return corte


def preview(db: Session) -> dict[str, Any]:
    """Qué cambiaría, sin tocar nada."""
    corte = _cutoff(db)
    filas = build_plan(*_fetch(db, corte), corte=corte)
    visibles = [{k: v for k, v in f.items() if k != "_celdas"} for f in filas]
    cambian = [f for f in visibles if f["estado"] == "reconstruir"]
    bloqueadas = [f for f in visibles if f["estado"] == "sin_fecha"]
    return {
        "cutoff_date": corte,
        "lineas": len(visibles),
        "a_reconstruir": len(cambian),
        "bloqueadas_sin_fecha": len(bloqueadas),
        "sin_cambios": len(visibles) - len(cambian) - len(bloqueadas),
        "celdas_a_borrar": sum(f["celdas_actuales"] for f in cambian),
        "celdas_a_escribir": sum(f["celdas_nuevas"] for f in cambian),
        "ajuste_total": sum((f["diferencia"] for f in cambian), Decimal(0)),
        "detalle": sorted(
            [f for f in visibles if f["estado"] != "sin_cambios"],
            key=lambda f: -abs(f["diferencia"]),
        ),
    }


def apply_plan(db: Session, codes: list[str] | None = None) -> dict[str, Any]:
    """Reescribe el historial (semanas < corte) de las líneas reconstruibles.

    `codes` acota a esas líneas; None = todas. Las bloqueadas por falta de fecha
    no se tocan nunca. Conserva el state_id que ya tenía cada semana.
    """
    corte = _cutoff(db)
    # Reescribe cientos de celdas: van todas bajo una etiqueta para que en la
    # bitácora se lean como un solo evento y no como ruido.
    set_audit_batch(db, "ledger-history")
    filas = build_plan(*_fetch(db, corte), corte=corte)
    elegidas = [
        f
        for f in filas
        if f["estado"] == "reconstruir" and (codes is None or f["wbs_code"] in codes)
    ]
    estado_def = int(
        db.execute(text("SELECT id FROM task_state ORDER BY sort_order, id LIMIT 1")).scalar() or 1
    )
    borradas = escritas = 0
    for f in elegidas:
        previos = {
            r.week_start: r.state_id
            for r in db.execute(
                text(
                    "SELECT week_start, state_id FROM schedule_cell "
                    "WHERE wbs_id = :w AND week_start < :c"
                ),
                {"w": f["wbs_id"], "c": corte},
            )
        }
        borradas += db.execute(
            text("DELETE FROM schedule_cell WHERE wbs_id = :w AND week_start < :c"),
            {"w": f["wbs_id"], "c": corte},
        ).rowcount
        for semana, monto in sorted(f["_celdas"].items()):
            db.execute(
                text(
                    "INSERT INTO schedule_cell "
                    "  (wbs_id, week_start, planned_amount, state_id, note) "
                    "VALUES (:w, :d, :m, :s, :n)"
                ),
                {
                    "w": f["wbs_id"],
                    "d": semana,
                    "m": monto,
                    "s": previos.get(semana, estado_def),
                    "n": NOTA,
                },
            )
            escritas += 1

    # El horizonte que dibuja el cronograma sale de settings; si un pago cae
    # antes (o despues) de ese rango, su celda existe pero la pantalla ni la
    # lista y el Timeline Total la pierde -> Control muestra un hueco falso.
    # Se ensancha para cubrir todo lo que hay escrito.
    horizonte = db.execute(
        text(
            "UPDATE settings SET horizon_start = LEAST(COALESCE(horizon_start, c.lo), c.lo), "
            "                    horizon_end   = GREATEST(COALESCE(horizon_end, c.hi), c.hi) "
            "FROM (SELECT MIN(week_start) AS lo, MAX(week_start) AS hi FROM schedule_cell) c "
            "WHERE c.lo IS NOT NULL "
            "RETURNING horizon_start, horizon_end"
        )
    ).first()
    return {
        "ok": True,
        "cutoff_date": corte,
        "lineas_reescritas": len(elegidas),
        "celdas_borradas": borradas,
        "celdas_escritas": escritas,
        "ajuste_total": sum((f["diferencia"] for f in elegidas), Decimal(0)),
        "wbs": [f["wbs_code"] for f in elegidas],
        "horizonte": [horizonte[0], horizonte[1]] if horizonte else None,
    }
