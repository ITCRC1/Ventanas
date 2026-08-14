"""Rescata el # de desembolso y la FECHA del texto del Payee del Ledger.

Las 263 filas del Ledger (réplica del Excel) tienen `src_disb_no` y `entry_date`
en NULL: el dato vive dentro del texto del Payee ("Disbursement #06 - 01/13/2025").
Sin fecha, el auto-match no puede distinguir entre 12 líneas idénticas de $3,750
(el Admin Fee de cada mes) y todo cae en "revisar".

Formato de fecha MEZCLADO en el Excel: si la 1ª parte es > 12 es DD/MM, si no
MM/DD (misma heurística que `etl/distribute_actuals.py`). Se respeta el año tal
cual está (el #07 dice 2026 — decisión del owner: no tocarlo).

Solo rellena lo que está en NULL; no pisa nada.

Revision ID: 0041_ledger_sheet_dates
Revises: 0040_line_vendor_recurring
Create Date: 2026-07-30
"""

from __future__ import annotations

import re
from datetime import date

from alembic import op
from sqlalchemy import text

revision = "0041_ledger_sheet_dates"
down_revision = "0040_line_vendor_recurring"
branch_labels = None
depends_on = None

_NO = re.compile(r"#\s*(\d{1,3})")
_DATE = re.compile(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})")


def _parse(payee: str | None) -> tuple[int | None, date | None]:
    if not payee:
        return None, None
    no = _NO.search(payee)
    disb_no = int(no.group(1)) if no else None
    d = _DATE.search(payee)
    entry: date | None = None
    if d:
        a, b, y = int(d.group(1)), int(d.group(2)), int(d.group(3))
        mo, day = (b, a) if a > 12 else (a, b)  # 1ª parte > 12 → DD/MM
        if 1 <= mo <= 12 and 1 <= day <= 31:
            try:
                entry = date(y, mo, day)
            except ValueError:
                entry = None
    return disb_no, entry


def upgrade() -> None:
    conn = op.get_bind()
    rows = conn.execute(
        text(
            "SELECT id, payee FROM ledger_sheet_row "
            "WHERE kind = 'data' AND (src_disb_no IS NULL OR entry_date IS NULL)"
        )
    ).all()
    for rid, payee in rows:
        disb_no, entry = _parse(payee)
        if disb_no is None and entry is None:
            continue
        conn.execute(
            text(
                # entry_date es TEXT en la réplica del Ledger (celda tal cual del
                # Excel): se guarda en ISO para poder ordenarla y compararla.
                "UPDATE ledger_sheet_row SET "
                "  src_disb_no = COALESCE(src_disb_no, CAST(:n AS integer)), "
                "  entry_date  = COALESCE(NULLIF(entry_date, ''), CAST(:d AS text)) "
                "WHERE id = :i"
            ),
            {"n": disb_no, "d": entry.isoformat() if entry else None, "i": rid},
        )


def downgrade() -> None:
    # No se revierte: el dato rescatado es el mismo que está en el texto del Payee.
    pass
