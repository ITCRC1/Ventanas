"""Ingesta del estado de cuenta LAFISE — PDF, CSV o .xls.

Un solo parser normaliza los tres formatos a la misma estructura de movimiento.
Las columnas se detectan por nombre de encabezado (Fecha / Descripción / Débito /
Crédito / Saldo / Número de confirmación / Tipo de Movimiento), así que si el
banco reordena o renombra levemente, sigue funcionando.

Cuidado (documentado en CLAUDE.md):
- El archivo viene del más reciente al más antiguo → el orden real de asiento es
  el invertido; se invierte al final.
- LAFISE le pone a la comisión el MISMO número de confirmación que a la
  transferencia que la origina; por eso la clave de idempotencia incluye la
  descripción y los montos (igual que la UNIQUE de bank_tx).

No inventa datos: si una fila no tiene fecha o monto, se descarta o se reporta,
no se rellena.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation

MESES = {
    "ENE": 1, "FEB": 2, "MAR": 3, "ABR": 4, "MAY": 5, "JUN": 6,
    "JUL": 7, "AGO": 8, "SET": 9, "SEP": 9, "OCT": 10, "NOV": 11, "DIC": 12,
}

_DATE_TXT = re.compile(r"(\d{1,2})[/\-]([A-Za-z]{3})[/\-](\d{4})")
_DATE_NUM = re.compile(r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})")


@dataclass
class Movement:
    tx_date: date
    txn_no: str | None
    description: str
    debit: Decimal | None
    credit: Decimal | None
    balance: Decimal | None
    mov_type: str | None  # 3O / AC / DB / TT …
    reference: str | None = None


@dataclass
class Statement:
    iban: str | None = None
    client: str | None = None
    currency: str | None = None
    period_from: date | None = None
    period_to: date | None = None
    movements: list[Movement] = field(default_factory=list)


# --- helpers ----------------------------------------------------------------


def _clean(s: object) -> str:
    return re.sub(r"\s+", " ", str(s or "").replace("\n", " ")).strip()


def _num(v: object) -> Decimal | None:
    s = re.sub(r"[^0-9.\-]", "", str(v or "").replace(",", ""))
    if not s or s in {"-", ".", "-."}:
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def _parse_date(txt: str) -> date | None:
    # El PDF parte el año en dos líneas ("30/JUN/202" + "6"); al limpiar queda un
    # espacio interno. Se quitan TODOS los espacios para que el año quede contiguo.
    txt = re.sub(r"\s+", "", str(txt or ""))
    m = _DATE_TXT.search(txt)
    if m:
        d, mon, y = m.group(1), m.group(2).upper(), m.group(3)
        mo = MESES.get(mon)
        if mo:
            try:
                return date(int(y), mo, int(d))
            except ValueError:
                return None
    m = _DATE_NUM.search(txt)
    if m:  # dd/mm/yyyy (formato del CSV/banco CR)
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return date(y, mo, d)
        except ValueError:
            return None
    return None


# --- normalización de una fila de 8 columnas --------------------------------
# Fecha | N° confirmación | Descripción | Débito | Crédito | Saldo | Ref | Tipo


def _row_to_movement(cells: list[str]) -> Movement | None:
    d = _parse_date(cells[0])
    if d is None:
        return None
    get = lambda i: cells[i] if i < len(cells) else ""  # noqa: E731
    return Movement(
        tx_date=d,
        txn_no=_clean(get(1)) or None,
        description=_clean(get(2)),
        debit=_num(get(3)),
        credit=_num(get(4)),
        balance=_num(get(5)),
        reference=_clean(get(6)) or None,
        mov_type=_clean(get(7)) or None,
    )


# --- metadatos de cabecera ---------------------------------------------------


def _read_meta(text: str, st: Statement) -> None:
    for line in text.splitlines():
        low = line.lower()
        if "nro. de cuenta" in low or "n�mero de cuenta" in low or "numero de cuenta" in low:
            m = re.search(r"(CR\d{20,22})", line)
            if m:
                st.iban = m.group(1)
        elif low.strip().startswith("cliente"):
            st.client = _clean(line.split(None, 1)[1]) if len(line.split(None, 1)) > 1 else None
        elif low.strip().startswith("moneda"):
            parts = line.split()
            if parts:
                st.currency = parts[-1].strip()
        if "desde" in low or "hasta" in low:
            if "desde" in low:
                dd = _parse_date_from_groups(line, first=True)
                if dd:
                    st.period_from = dd
            if "hasta" in low:
                dd = _parse_date_from_groups(line, first=False)
                if dd:
                    st.period_to = dd


def _parse_date_from_groups(line: str, first: bool) -> date | None:
    matches = list(_DATE_TXT.finditer(line)) or list(_DATE_NUM.finditer(line))
    if not matches:
        return None
    m = matches[0] if first else matches[-1]
    return _parse_date(m.group(0))


# --- PDF ---------------------------------------------------------------------


def parse_pdf(data: bytes) -> Statement:
    import pdfplumber  # lazy: solo si llega un PDF

    st = Statement()
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        meta_txt = pdf.pages[0].extract_text() or ""
        _read_meta(meta_txt, st)
        for page in pdf.pages:
            for tbl in page.extract_tables():
                for row in tbl:
                    if not row or len(row) < 6:
                        continue
                    cells = [(_clean(c)) for c in row]
                    mv = _row_to_movement(cells)
                    if mv is not None:
                        st.movements.append(mv)
    _finalize(st)
    return st


# --- CSV ---------------------------------------------------------------------

_HEADER_MAP = {
    "fecha": 0, "número de confirmación": 1, "numero de confirmacion": 1,
    "número de confirmaci�n": 1, "n. de confirmación": 1,
    "confirmación": 1, "confirmacion": 1, "referencia": 6,
    "descripción": 2, "descripcion": 2, "detalle": 2,
    "débito": 3, "debito": 3, "debe": 3,
    "crédito": 4, "credito": 4, "haber": 4,
    "saldo": 5, "tipo de movimiento": 7, "tipo": 7,
}


def _map_header(headers: list[str]) -> dict[int, int] | None:
    """Devuelve {idx_col_archivo: idx_col_normalizado} o None si no reconoce."""
    out: dict[int, int] = {}
    for i, h in enumerate(headers):
        key = _clean(h).lower()
        if key in _HEADER_MAP:
            out[i] = _HEADER_MAP[key]
    # necesita al menos Fecha, Descripción y (Débito o Crédito)
    slots = set(out.values())
    if 0 in slots and 2 in slots and (3 in slots or 4 in slots):
        return out
    return None


def parse_csv(data: bytes) -> Statement:
    st = Statement()
    text = data.decode("utf-8-sig", errors="replace")
    # LAFISE suele exportar con ; en locale CR; detectar el separador
    sample = text[:4000]
    delim = ";" if sample.count(";") > sample.count(",") else ","
    reader = list(csv.reader(io.StringIO(text), delimiter=delim))
    # metadatos: las primeras filas de una sola/dos columnas
    header_idx = None
    colmap: dict[int, int] | None = None
    for i, row in enumerate(reader):
        cm = _map_header(row)
        if cm:
            header_idx, colmap = i, cm
            break
    _read_meta("\n".join(" ".join(r) for r in reader[: (header_idx or 20)]), st)
    if colmap is None:
        _finalize(st)
        return st
    for row in reader[header_idx + 1:]:
        if not any(_clean(c) for c in row):
            continue
        cells = [""] * 8
        for src, dst in colmap.items():
            if src < len(row):
                cells[dst] = _clean(row[src])
        mv = _row_to_movement(cells)
        if mv is not None:
            st.movements.append(mv)
    _finalize(st)
    return st


# --- XLS (banca en línea) ----------------------------------------------------


def parse_xls(data: bytes) -> Statement:
    import xlrd  # lazy

    st = Statement()
    sh = xlrd.open_workbook(file_contents=data).sheet_by_index(0)
    rows = [[_clean(sh.cell_value(r, c)) for c in range(sh.ncols)] for r in range(sh.nrows)]
    header_idx = None
    colmap: dict[int, int] | None = None
    for i, row in enumerate(rows[:40]):
        cm = _map_header(row)
        if cm:
            header_idx, colmap = i, cm
            break
    _read_meta("\n".join(" ".join(r) for r in rows[: (header_idx or 40)]), st)
    if colmap is None:
        _finalize(st)
        return st
    for row in rows[header_idx + 1:]:
        cells = [""] * 8
        for src, dst in colmap.items():
            if src < len(row):
                cells[dst] = row[src]
        mv = _row_to_movement(cells)
        if mv is not None:
            st.movements.append(mv)
    _finalize(st)
    return st


# --- común -------------------------------------------------------------------


def _finalize(st: Statement) -> None:
    """El archivo viene del más reciente al más antiguo: invertir a orden de asiento.

    Deriva el período de los propios movimientos si la cabecera no lo trajo.
    """
    st.movements.reverse()
    if st.movements:
        fechas = [m.tx_date for m in st.movements]
        st.period_from = st.period_from or min(fechas)
        st.period_to = st.period_to or max(fechas)


def parse(filename: str, data: bytes) -> Statement:
    name = (filename or "").lower()
    head = data[:8]
    if name.endswith(".pdf") or head.startswith(b"%PDF"):
        return parse_pdf(data)
    if name.endswith(".csv"):
        return parse_csv(data)
    if name.endswith((".xls", ".xlsx")) or head.startswith(b"\xd0\xcf\x11\xe0") or head.startswith(b"PK"):
        return parse_xls(data)
    # último recurso: intentar CSV
    return parse_csv(data)
