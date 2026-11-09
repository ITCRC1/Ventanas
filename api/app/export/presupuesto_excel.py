"""La propuesta de presupuesto anual, en Excel — tres hojas que se pueden leer.

Toma lo que calculó `services/presupuesto.py` — no recalcula nada: la pantalla
y este archivo tienen que decir lo mismo siempre.

⚠️ TRES HOJAS, no una de sesenta columnas.

Owner, 2026-11-08: *«quiero que haya varios sub tabs dentro del tab para hacerlo
fácil de leer. Sub tab 1, el master data de cada proyecto, hasta la columna M.
Sub tab 2, solo las primeras columnas de la A la D, y el mes a mes hasta
diciembre; de la A a la D fijo y el mes se va moviendo hasta llegar a diciembre
y seguido el Total. Y el sub tab 3, ya cómo va quedando el Budget, de Enero a
Diciembre»*.

  1 Line Data       el master data de cada línea, A..M
  2 Month by Month  A..D fijas y los doce meses, con su total
  3 Budget {año}    cómo va quedando el año, una fila por sección

Las tres salen del MISMO payload y en el MISMO orden, así que una línea cae en
la misma fila en las tres: saltar de hoja no te mueve la línea que mirabas.

Los totales van por fórmula, como en el resto del libro: si alguien ajusta un
monto, los subtotales y el total se mueven con él. Un total pegado se
desincroniza en el primer ajuste y nadie se entera.

En inglés porque el destinatario es el dueño (pedido del 2026-11-08), aunque la
pantalla de la que sale esté en español.
"""

from __future__ import annotations

import datetime as dt
import io
from collections import defaultdict
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as gc

TEAL = "FF0F5F59"
AZUL = "FF1F4E79"
AMBAR = "FF8A5A00"
BANDA = "FFEAF0FA"
SUBTOT = "FFDCE6F4"
LEDGER = "FFFFF3CD"
GRIS = "FF787B86"
MONEDA = '"$"#,##0;[Red]-"$"#,##0;"—"'
MEDIO = Side(style="medium", color="FF9AA4B2")
BLANCO = Font(bold=True, color="FFFFFFFF", size=9)
MESES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
         "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def _por_mes(f: dict[str, Any]) -> list[float]:
    """Los doce meses de una línea, sumando sus semanas."""
    m = [0.0] * 12
    for w, v in (f.get("propuesta") or {}).items():
        i = int(str(w)[5:7]) - 1
        if 0 <= i < 12:
            m[i] += float(v or 0)
    return m


def _titulo(ws: Any, t: str, sub: str) -> None:
    ws.sheet_view.showGridLines = False
    ws["A1"] = t
    ws["A1"].font = Font(bold=True, size=15, color=TEAL)
    ws["A2"] = sub
    ws["A2"].font = Font(size=10, color=GRIS)
    ws["A3"] = (
        f"Generated {dt.date.today():%d/%m/%Y} · a proposal to review — "
        "it changes nothing in the system"
    )
    ws["A3"].font = Font(size=9, italic=True, color=GRIS)


def _cabecera(ws: Any, hr: int, cols: list[tuple[str, int]], fondo: str) -> None:
    for i, (h, w) in enumerate(cols, 1):
        c = ws.cell(hr, i, h)
        c.fill = PatternFill("solid", fgColor=fondo)
        c.font = BLANCO
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[gc(i)].width = w
    ws.row_dimensions[hr].height = 30


def _cerrar(ws: Any, hr: int, ult: int, ultima: int, congelar: int) -> None:
    # ⚠️ La coordenada como TEXTO, no `ws.cell(...)`: la primera fila de datos
    # es la banda de categoria, que esta combinada, y openpyxl no sabe leer una
    # MergedCell como referencia de congelado.
    ws.freeze_panes = f"{gc(congelar)}{hr + 1}"
    ws.auto_filter.ref = f"A{hr}:{gc(ult)}{ultima}"
    ws.print_title_rows = f"{hr}:{hr}"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def propuesta_a_xlsx(d: dict[str, Any]) -> bytes:
    anio = d["anio"]
    filas: list[dict[str, Any]] = d["filas"]
    # ⚠️ `totales` y no `tot`: mas abajo `tot` es la FILA del gran total.
    # Con el mismo nombre, la fila pisaba el diccionario y la hoja Control
    # reventaba con "int object is not subscriptable".
    totales = d["totales"]

    por_cat: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in filas:
        por_cat[f["category"]].append(f)

    # El plano: en qué fila cae cada cosa. Se resuelve UNA vez y las tres hojas
    # lo usan, por eso coinciden fila a fila por construcción.
    hr = 6
    plano: list[dict[str, Any]] = []
    r = hr + 1
    for cat, ls in por_cat.items():
        plano.append({"t": "cat", "fila": r, "cat": cat})
        r += 1
        ini = r
        for f in ls:
            plano.append({"t": "linea", "fila": r, "f": f, "cat": cat})
            r += 1
        plano.append({"t": "sub", "fila": r, "cat": cat, "tramo": (ini, r - 1), "n": len(ls)})
        r += 1
    plano.append({"t": "tot", "fila": r, "subs": [p["fila"] for p in plano if p["t"] == "sub"]})
    ultima = r

    wb = Workbook()
    _hoja_datos(wb.active, anio, hr, plano, ultima)
    _hoja_meses(wb.create_sheet("2 Month by Month"), anio, hr, plano, ultima)
    _hoja_anio(wb.create_sheet(f"3 Budget {anio}"), anio, hr, plano, por_cat)
    _hoja_control(wb.create_sheet("Control"), anio, totales)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ── 1 · El master data de cada línea, A..M ─────────────────────────────────

def _hoja_datos(
    ws: Any, anio: int, hr: int, plano: list[dict[str, Any]], ultima: int
) -> None:
    ws.title = "1 Line Data"
    _titulo(
        ws,
        f"VENTANAS — {anio} BUDGET PROPOSAL · LINE DATA",
        "Every Job Cost line, with what it has and how the remaining splits into "
        "the four tranches. PROPOSAL = overdue + carry-over + plan, and it is a "
        "formula: J+K+L.",
    )
    _cabecera(ws, hr, [
        ("WBS", 12), ("TASK", 42), ("CATEGORY", 20), ("PHASE", 16), ("OWNER", 16),
        ("BUDGET", 15), ("SPENT", 15), ("REMAINING", 15),
        ("OVERDUE", 14), ("CARRY-OVER", 14), (f"PLAN {anio}", 14),
        (f"AFTER {anio}", 14), ("PROPOSAL", 16),
    ], TEAL)

    for p in plano:
        r = p["fila"]
        if p["t"] == "cat":
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=13)
            b = ws.cell(r, 1, p["cat"].upper())
            b.fill = PatternFill("solid", fgColor=BANDA)
            b.font = Font(bold=True, size=10, color=TEAL)
            continue
        if p["t"] == "linea":
            f = p["f"]
            ws.cell(r, 1, f["wbs_code"]).font = Font(name="Consolas", size=9)
            ws.cell(r, 2, f["title"]).alignment = Alignment(wrap_text=True, vertical="top")
            ws.cell(r, 3, f["category"])
            ws.cell(r, 4, f["phase"])
            ws.cell(r, 5, f["owner"])
            # Datos base del Job Cost.
            for col, k in ((6, "budget_revised"), (7, "spend"),
                           (9, "vencido"), (10, "arrastre"),
                           (11, "plan_total"), (12, "posterior")):
                cel = ws.cell(r, col, f[k])
                cel.number_format = MONEDA
                if col == 9 and f["vencido"]:
                    cel.fill = PatternFill("solid", fgColor="FFF4CCCC")
                    cel.font = Font(bold=True, color="FF9C0006")
                elif col == 10 and f["arrastre"]:
                    cel.fill = PatternFill("solid", fgColor=LEDGER)
            # Derivados: se calculan en la hoja, no se copian.
            ws.cell(r, 8, f"=F{r}-G{r}").number_format = MONEDA
            pr = ws.cell(r, 13, f"=I{r}+J{r}+K{r}")
            pr.number_format = MONEDA
            pr.font = Font(bold=True)
            continue
        # Subtotal o gran total.
        fondo = SUBTOT if p["t"] == "sub" else TEAL
        for i in range(1, 14):
            cc = ws.cell(r, i)
            cc.fill = PatternFill("solid", fgColor=fondo)
            if p["t"] == "sub":
                cc.border = Border(top=MEDIO, bottom=MEDIO)
        etq = f"Subtotal {p['cat']}" if p["t"] == "sub" else f"TOTAL {anio}"
        col = Font(bold=True) if p["t"] == "sub" else Font(bold=True, size=11, color="FFFFFFFF")
        ws.cell(r, 2, etq).font = col
        for c in range(6, 14):
            ref = (
                f"=SUM({gc(c)}{p['tramo'][0]}:{gc(c)}{p['tramo'][1]})"
                if p["t"] == "sub"
                else "=" + "+".join(f"{gc(c)}{x}" for x in p["subs"])
            )
            cc = ws.cell(r, c, ref)
            cc.number_format = MONEDA
            cc.font = col
    _cerrar(ws, hr, 13, ultima, 6)


# ── 2 · A..D fijas y los doce meses ────────────────────────────────────────

def _hoja_meses(
    ws: Any, anio: int, hr: int, plano: list[dict[str, Any]], ultima: int
) -> None:
    _titulo(
        ws,
        f"VENTANAS — {anio} BUDGET PROPOSAL · MONTH BY MONTH",
        "Who the line is (A..D, frozen) and the twelve months, January through "
        "December, with the row total. The months are the weekly proposal rolled "
        "up; every total is a formula.",
    )
    cols = [("WBS", 12), ("TASK", 42), ("CATEGORY", 20), ("PHASE", 16)]
    cols += [(m, 13) for m in MESES]
    cols += [(f"TOTAL {anio}", 16)]
    _cabecera(ws, hr, cols, TEAL)
    for i in range(5, 17):
        ws.cell(hr, i).fill = PatternFill("solid", fgColor=AZUL)
    ws.cell(hr, 17).fill = PatternFill("solid", fgColor=AMBAR)

    for p in plano:
        r = p["fila"]
        if p["t"] == "cat":
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=17)
            b = ws.cell(r, 1, p["cat"].upper())
            b.fill = PatternFill("solid", fgColor=BANDA)
            b.font = Font(bold=True, size=10, color=TEAL)
            continue
        if p["t"] == "linea":
            f = p["f"]
            ws.cell(r, 1, f["wbs_code"]).font = Font(name="Consolas", size=9)
            ws.cell(r, 2, f["title"]).alignment = Alignment(wrap_text=True, vertical="top")
            ws.cell(r, 3, f["category"])
            ws.cell(r, 4, f["phase"])
            for i, v in enumerate(_por_mes(f)):
                ws.cell(r, 5 + i, round(v, 2)).number_format = MONEDA
        else:
            fondo = SUBTOT if p["t"] == "sub" else TEAL
            for i in range(1, 18):
                cc = ws.cell(r, i)
                cc.fill = PatternFill("solid", fgColor=fondo)
                if p["t"] == "sub":
                    cc.border = Border(top=MEDIO, bottom=MEDIO)
            etq = f"Subtotal {p['cat']}" if p["t"] == "sub" else f"TOTAL {anio}"
            col = (
                Font(bold=True) if p["t"] == "sub"
                else Font(bold=True, size=11, color="FFFFFFFF")
            )
            ws.cell(r, 2, etq).font = col
            for c in range(5, 17):
                ref = (
                    f"=SUM({gc(c)}{p['tramo'][0]}:{gc(c)}{p['tramo'][1]})"
                    if p["t"] == "sub"
                    else "=" + "+".join(f"{gc(c)}{x}" for x in p["subs"])
                )
                cc = ws.cell(r, c, ref)
                cc.number_format = MONEDA
                cc.font = col
        # El total de la fila suma sus propios meses, en las tres clases de fila.
        tt = ws.cell(r, 17, f"=SUM(E{r}:P{r})")
        tt.number_format = MONEDA
        tt.font = Font(bold=True)
    # ⚠️ A..D fijas: el pedido era que la identidad no se vaya con el scroll.
    _cerrar(ws, hr, 17, ultima, 5)


# ── 3 · Cómo va quedando el año, por sección ───────────────────────────────

def _hoja_anio(
    ws: Any, anio: int, hr: int, plano: list[dict[str, Any]],
    por_cat: dict[str, list[dict[str, Any]]],
) -> None:
    _titulo(
        ws,
        f"VENTANAS — {anio} BUDGET",
        f"How the {anio} budget is shaping up: one row per section, January "
        f"through December. Each cell points at that section's subtotal on "
        f"«2 Month by Month», so the two can never disagree.",
    )
    cols = [("SECTION", 34), ("LINES", 9)]
    cols += [(m, 14) for m in MESES]
    cols += [(f"TOTAL {anio}", 17)]
    _cabecera(ws, hr, cols, AZUL)
    ws.cell(hr, 15).fill = PatternFill("solid", fgColor=AZUL)
    ws.cell(hr, len(cols)).fill = PatternFill("solid", fgColor=AMBAR)

    subs = {p["cat"]: p["fila"] for p in plano if p["t"] == "sub"}
    MM = "'2 Month by Month'"
    r = hr + 1
    primeras: list[int] = []
    for cat in por_cat:
        ws.cell(r, 1, cat.upper()).font = Font(bold=True, size=10, color=TEAL)
        ws.cell(r, 2, len(por_cat[cat])).alignment = Alignment(horizontal="right")
        for i in range(12):
            cel = ws.cell(r, 3 + i, f"={MM}!{gc(5 + i)}{subs[cat]}")
            cel.number_format = MONEDA
        tt = ws.cell(r, 15, f"=SUM(C{r}:N{r})")
        tt.number_format = MONEDA
        tt.font = Font(bold=True)
        primeras.append(r)
        r += 1

    for i in range(1, 16):
        ws.cell(r, i).fill = PatternFill("solid", fgColor=AZUL)
    ws.cell(r, 1, f"TOTAL {anio}").font = Font(bold=True, size=11, color="FFFFFFFF")
    ws.cell(r, 2, "=" + "+".join(f"B{x}" for x in primeras)).font = Font(
        bold=True, color="FFFFFFFF"
    )
    for c in range(3, 16):
        cc = ws.cell(r, c, "=" + "+".join(f"{gc(c)}{x}" for x in primeras))
        cc.number_format = MONEDA
        cc.font = Font(bold=True, size=11, color="FFFFFFFF")
    _cerrar(ws, hr, 15, r, 3)


# ── Control: que los cuatro tramos cierren ─────────────────────────────────

def _hoja_control(ws: Any, anio: int, totales: dict[str, Any]) -> None:
    ws.sheet_view.showGridLines = False
    ws["A1"] = "THE REMAINING, SPLIT FOUR WAYS"
    ws["A1"].font = Font(bold=True, size=14, color=TEAL)
    ws["A2"] = (
        "The four tranches have to add up to the Job Cost remaining. If "
        "«Unplaced» is not zero, there is money the schedule puts in no year at "
        "all — and then the budget is incomplete."
    )
    ws["A2"].font = Font(size=10, color=GRIS)
    ws["A2"].alignment = Alignment(wrap_text=True)
    ws.row_dimensions[2].height = 30
    f2 = 4
    for et, k in (
        ("Budget revised", "budget_revised"),
        ("Spent", "spend"),
        ("REMAINING", "remanente"),
        ("", None),
        ("Overdue — the week already passed", "vencido"),
        ("Carry-over — today to year end", "arrastre"),
        (f"Plan {anio}", "plan"),
        (f"After {anio}", "posterior"),
        ("", None),
        ("Unplaced (must be 0)", "sin_ubicar"),
        ("", None),
        (f"PROPOSAL {anio} = overdue + carry-over + plan", "propuesta"),
        ("Job Cost lines", "lineas"),
    ):
        if k is None:
            f2 += 1
            continue
        ws.cell(f2, 1, et).font = Font(size=10, color=GRIS)
        c = ws.cell(f2, 2, totales[k])
        c.number_format = "#,##0" if k == "lineas" else MONEDA
        c.font = Font(bold=True, size=11)
        if k == "sin_ubicar" and abs(totales[k]) > 5:
            c.fill = PatternFill("solid", fgColor="FFF4CCCC")
            c.font = Font(bold=True, size=11, color="FF9C0006")
        f2 += 1
    for col, w in ((1, 42), (2, 20)):
        ws.column_dimensions[gc(col)].width = w
