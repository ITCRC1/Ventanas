"""Importa la hoja 'US Wire Transfers' del Excel a us_wire_row (espejo fiel).

Control de los aportes de los dueños: bloque Ventanas I (wires al escrow) +
bloque Ventanas II (Disb. Request). Idempotente (TRUNCATE + reload).

Uso:
    python etl/import_us_wires.py "<ruta>/VENTANAS JOB COST REP ... FINAL.xlsm" \
        --pg "postgresql+psycopg://user:pass@host:port/db"
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
from decimal import Decimal, InvalidOperation

import openpyxl
from sqlalchemy import create_engine, text

_SHEET = "US Wire Transfers"


def _dec(v: object) -> Decimal | None:
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except (InvalidOperation, ValueError):
        return None


def _str(v: object) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def extract(path: str) -> list[dict]:
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb[_SHEET]
    rows: list[dict] = []
    order = 0
    for row in ws.iter_rows(min_row=1, max_row=60, values_only=True):
        a = row[0]  # col A
        # Bloque Ventanas I: col A = fecha (datetime), sin trans_label.
        if isinstance(a, dt.datetime):
            order += 1
            rows.append(
                {
                    "sort_order": order,
                    "block": "ventanas_i",
                    "trans_label": None,
                    "wire_date": a.date(),
                    "sender": _str(row[2]),
                    "from_party": _str(row[3]),
                    "to_party": _str(row[4]),
                    "account_number": _str(row[5]),
                    "amount_received": _dec(row[6]) or Decimal(0),
                    "amount_sent": _dec(row[7]),
                    "notas": _str(row[8]),
                }
            )
        # Bloque Ventanas II: col A = "Disb. Request ...", col B = fecha.
        elif isinstance(a, str) and a.strip().lower().startswith("disb"):
            order += 1
            b = row[1]
            rows.append(
                {
                    "sort_order": order,
                    "block": "ventanas_ii",
                    "trans_label": a.strip(),
                    "wire_date": b.date() if isinstance(b, dt.datetime) else None,
                    "sender": _str(row[2]),
                    "from_party": _str(row[3]),
                    "to_party": _str(row[4]),
                    "account_number": _str(row[5]),
                    "amount_received": _dec(row[6]) or Decimal(0),
                    "amount_sent": _dec(row[7]),
                    "notas": _str(row[8]),
                }
            )
        # cualquier otra fila (títulos, TOTAL TRANSFER, LAFISE BALANCE, vacías) → se ignora
    return rows


_COLS = [
    "sort_order",
    "block",
    "trans_label",
    "wire_date",
    "sender",
    "from_party",
    "to_party",
    "account_number",
    "amount_received",
    "amount_sent",
    "notas",
]


def load(rows: list[dict], url: str) -> None:
    engine = create_engine(url)
    ph = ", ".join(f":{c}" for c in _COLS)
    stmt = text(f"INSERT INTO us_wire_row ({', '.join(_COLS)}) VALUES ({ph})")  # noqa: S608
    with engine.begin() as c:
        c.execute(text("TRUNCATE us_wire_row RESTART IDENTITY"))
        for r in rows:
            c.execute(stmt, {k: r.get(k) for k in _COLS})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsm", help="ruta al VENTANAS JOB COST REP ... FINAL.xlsm")
    ap.add_argument("--pg", default=os.environ.get("DATABASE_URL"))
    args = ap.parse_args()
    if not args.pg:
        raise SystemExit("Falta --pg o env DATABASE_URL")
    rows = extract(args.xlsm)
    load(rows, args.pg)
    total = sum((r["amount_received"] for r in rows), Decimal(0))
    vi = sum((r["amount_received"] for r in rows if r["block"] == "ventanas_i"), Decimal(0))
    vii = sum((r["amount_received"] for r in rows if r["block"] == "ventanas_ii"), Decimal(0))
    print(f"OK: {len(rows)} wires → us_wire_row | Ventanas I {vi} + II {vii} = {total}")


if __name__ == "__main__":
    main()
