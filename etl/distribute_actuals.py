#!/usr/bin/env python3
"""Distribuye los ACTUALES del Ledger en el timeline del Job Cost, por mes.

Regla del owner: "si está en el Ledger, es gasto actual". Cada línea de
ledger_sheet_row (amount_paid) se ubica en la ÚLTIMA SEMANA de su mes, para los
meses ANTERIORES a la fecha de corte (settings.cutoff_date). El futuro (>= corte)
queda como plan. Así Timeline Total (pasado actual + futuro plan) = Forecast y la
columna CONTROL del Job Cost da $0.

El mes de cada línea sale de:
  1. la fecha en el texto del Payee  ("Disbursement #NN - MM/DD/YYYY"), o
  2. la fecha en la Description       (ej. "Helicopter Wire - 25/7/2024"), o
  3. si no hay fecha → última semana de actuales (antes del corte).

Formato de fecha MEZCLADO (MM/DD y DD/MM): heurística = si la 1ª parte > 12 es
DD/MM. Fix del año de #07 (dice 2026, es 2025).

Idempotente: hace backup de las celdas pasadas, borra el pasado y lo reconstruye.

Uso:
  python etl/distribute_actuals.py --pg "postgresql+psycopg://user:pass@host:port/db"
"""

from __future__ import annotations

import argparse
import json
import os
import re
from datetime import date, timedelta

from sqlalchemy import create_engine, text

_DATE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")


def parse_ym(text_val: str | None, is_disb07: bool = False) -> tuple[int, int] | None:
    m = _DATE.search(text_val or "")
    if not m:
        return None
    a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    mo = b if a > 12 else a  # si 1ª parte > 12 → DD/MM
    if is_disb07 and y == 2026:  # bug de año conocido del #07
        y = 2025
    if mo < 1 or mo > 12:
        return None
    return (y, mo)


def last_monday_of_month(y: int, mo: int) -> date:
    nxt = date(y + 1, 1, 1) if mo == 12 else date(y, mo + 1, 1)
    last = nxt - timedelta(days=1)
    return last - timedelta(days=last.weekday())


def last_actual_monday(cutoff: date) -> date:
    """Lunes de la última semana de actuales (la primera anterior al corte)."""
    d = cutoff - timedelta(days=1)
    return d - timedelta(days=d.weekday())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pg", default=os.environ.get("DATABASE_URL"))
    ap.add_argument("--backup", default="sched_backup.json")
    a = ap.parse_args()
    if not a.pg:
        raise SystemExit("Falta --pg o env DATABASE_URL")

    engine = create_engine(a.pg)
    with engine.begin() as c:
        cutoff = c.execute(text("SELECT cutoff_date FROM settings LIMIT 1")).scalar()
        if cutoff is None:
            raise SystemExit("No hay settings.cutoff_date")

        # backup de las celdas pasadas (por si hay que revertir)
        bak = [
            {
                "wbs_id": r["wbs_id"],
                "week_start": r["week_start"],
                "planned_amount": (str(r["planned_amount"]) if r["planned_amount"] is not None else None),
                "state_id": r["state_id"],
                "note": r["note"],
            }
            for r in c.execute(
                text(
                    "SELECT wbs_id, to_char(week_start,'YYYY-MM-DD') week_start, "
                    "planned_amount, state_id, note FROM schedule_cell WHERE week_start < :co"
                ),
                {"co": cutoff},
            ).mappings()
        ]
        with open(a.backup, "w", encoding="utf-8") as fh:
            json.dump(bak, fh)

        # actual por (wbs, semana) desde el ledger
        rows = c.execute(
            text(
                "SELECT r.payee, r.description, r.amount_paid, w.id wid, w.state_id "
                "FROM ledger_sheet_row r JOIN wbs_item w ON w.wbs_code = r.cost_code "
                "WHERE r.kind='data' AND r.amount_paid <> 0"
            )
        ).mappings()
        agg: dict[tuple[int, date], list] = {}  # (wid, monday) -> [amount, state_id]
        for r in rows:
            is07 = "#07" in (r["payee"] or "")
            ym = parse_ym(r["payee"], is07) or parse_ym(r["description"])
            monday = last_monday_of_month(*ym) if ym else last_actual_monday(cutoff)
            if monday >= cutoff:  # solo actuales (antes del corte)
                monday = last_actual_monday(cutoff)
            key = (r["wid"], monday)
            prev = agg.get(key, [0.0, r["state_id"]])
            agg[key] = [prev[0] + float(r["amount_paid"]), prev[1]]

        # limpiar el pasado y reconstruir con los actuales
        c.execute(text("DELETE FROM schedule_cell WHERE week_start < :co"), {"co": cutoff})
        for (wid, monday), (amt, stid) in agg.items():
            c.execute(
                text(
                    "INSERT INTO schedule_cell (wbs_id, week_start, planned_amount, state_id, note) "
                    "VALUES (:w, :k, :a, :s, 'Actual del Ledger')"
                ),
                {"w": wid, "k": monday, "a": round(amt, 2), "s": stid},
            )

    print(f"Corte: {cutoff} | backup: {len(bak)} celdas | actuales creados: {len(agg)}")
    print(f"Total distribuido: {sum(v[0] for v in agg.values()):,.2f}")


if __name__ == "__main__":
    main()
