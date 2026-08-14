"""Importa la hoja LEDGER del Excel TAL CUAL a ledger_sheet_row (espejo fiel).

Preserva cada celda como está: el texto del Payee ("Disbursement #01 - 06/05/2024"),
PAID TOTAL ("VENTANAS I"), Payment Info, Bank Paid From, y las secciones de abajo
(Unrecorded Center / Estimates & Quotes / Service Done). No normaliza ni recalcula:
esto es para que el tab LEDGER se vea idéntico al master.

Uso:
  python etl/import_ledger_sheet.py "ruta\\VENTANAS JOB COST REP ... FINAL.xlsm" \
      --pg "postgresql+psycopg://user:pass@host:port/db"

Idempotente: vacía la tabla y recarga. --pg opcional (default = env DATABASE_URL).
"""

from __future__ import annotations

import argparse
import os
import re
from decimal import Decimal, InvalidOperation

import openpyxl
from sqlalchemy import create_engine, text

# Encabezado de la hoja (fila 6) -> columna de la tabla. Se normaliza con strip().
_HEADER_MAP = {
    "Cost Code": "cost_code",
    "Account": "account",
    "Date": "entry_date",
    "Invoice #": "invoice_no",
    "Payee": "payee",
    "Description": "description",
    "Colones": "colones",
    "Amount": "amount",
    "Amount Paid": "amount_paid",
    "Amount Due": "amount_due",
    "PAID TOTAL": "paid_total",
    "Paid": "date_paid",  # cabecera de dos filas "Date"/"Paid" = Date Paid
    "Payment Info": "payment_info",
    "Bank Paid From": "bank_paid_from",
    "Request": "request",
    "Notes": "notes",
}
_NUMERIC = {"colones", "amount", "amount_paid", "amount_due"}
_SECTIONS = ("Unrecorded Center", "Estimates & Quotes", "Service Done/Not Posted")


def _section_of(a: str | None) -> str | None:
    if not a:
        return None
    for s in _SECTIONS:
        if a.startswith(s):
            return s
    return None


def _meaningful(cost_code: str | None, account: str | None, payee: str | None) -> bool:
    """Fila real del ledger: tiene un cost code (WBS) o un nombre de cuenta.
    Descarta el pie de reconciliación ("Must Equal $0", "Grand Total in Sage")
    y la basura de fórmulas (payee numérico, 'Date', filas #N/A), que no tienen
    ni cost code ni cuenta."""
    if cost_code and re.match(r"^[0-9]", cost_code):
        return True
    return bool(account)


def _txt(v: object) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    if s == "" or s == "#N/A" or s.startswith("#"):
        return None
    return s


def _num(v: object) -> Decimal | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return Decimal(str(round(v, 2)))
    s = str(v).replace("$", "").replace(",", "").strip()
    if s in ("", "-"):
        return None
    try:
        return Decimal(s).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None


def extract(path: str) -> tuple[list[dict], list[dict]]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb["LEDGER"]
    rows = list(ws.iter_rows(values_only=True))

    # localizar la fila de encabezado (A == 'Cost Code')
    hdr_idx = next(i for i, r in enumerate(rows) if r and str(r[0]).strip() == "Cost Code")
    col_of: dict[str, int] = {}
    for j, cell in enumerate(rows[hdr_idx]):
        key = str(cell).strip() if cell is not None else ""
        if key in _HEADER_MAP:
            col_of.setdefault(_HEADER_MAP[key], j)

    # metadatos de cabecera (Project / Address / Última actualización)
    meta: list[dict] = []
    for i in range(hdr_idx):
        r = rows[i]
        label = str(r[0]).strip() if r and r[0] is not None else ""
        if label in ("Project:", "Address:", "Última actualización:"):
            value = next((str(c).strip() for c in r[1:] if c not in (None, "")), "")
            meta.append({"row_no": i + 1, "label": label, "value": value})

    out: list[dict] = []
    section = "Ledger"
    seen_section: set[str] = set()
    for i in range(hdr_idx + 1, len(rows)):
        r = rows[i]
        cells = {c: (r[j] if j < len(r) else None) for c, j in col_of.items()}
        vals = {c: (_num(cells[c]) if c in _NUMERIC else _txt(cells[c])) for c in col_of}

        # cabecera de sección (Unrecorded Center / Estimates & Quotes / Service Done)
        sec = _section_of(_txt(cells.get("cost_code")))
        if sec:
            section = sec
            if sec not in seen_section:
                seen_section.add(sec)
                out.append({"row_no": i + 1, "section": section, "kind": "section", **_blank(vals)})
            continue

        # solo filas con contenido real; se descartan totales/basura de fórmulas
        if not _meaningful(vals.get("cost_code"), vals.get("account"), vals.get("payee")):
            continue

        out.append({"row_no": i + 1, "section": section, "kind": "data", **vals})
    return meta, out


def _blank(vals: dict) -> dict:
    return dict.fromkeys(vals)


_COLS = list(_HEADER_MAP.values())


def load(meta: list[dict], rows: list[dict], url: str) -> None:
    engine = create_engine(url)
    with engine.begin() as c:
        c.execute(text("TRUNCATE ledger_sheet_row RESTART IDENTITY"))
        # metadatos como filas kind='meta' (cost_code=label, account=value)
        for m in meta:
            c.execute(
                text(
                    "INSERT INTO ledger_sheet_row (row_no, section, kind, cost_code, account) "
                    "VALUES (:row_no, 'meta', 'meta', :label, :value)"
                ),
                {"row_no": m["row_no"], "label": m["label"], "value": m["value"]},
            )
        cols = ["row_no", "section", "kind", *_COLS]
        placeholders = ", ".join(f":{c}" for c in cols)
        stmt = text(
            f"INSERT INTO ledger_sheet_row ({', '.join(cols)}) VALUES ({placeholders})"  # noqa: S608
        )
        for r in rows:
            c.execute(stmt, {c: r.get(c) for c in cols})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsm", help="ruta al VENTANAS JOB COST REP ... FINAL.xlsm")
    ap.add_argument("--pg", default=os.environ.get("DATABASE_URL"), help="URL Postgres")
    args = ap.parse_args()
    if not args.pg:
        raise SystemExit("Falta --pg o env DATABASE_URL")

    meta, rows = extract(args.xlsm)
    data = [r for r in rows if r["kind"] == "data"]
    secs = [r for r in rows if r["kind"] == "section"]
    load(meta, rows, args.pg)
    print(f"OK: {len(meta)} meta, {len(secs)} secciones, {len(data)} filas de datos → ledger_sheet_row")


if __name__ == "__main__":
    main()
