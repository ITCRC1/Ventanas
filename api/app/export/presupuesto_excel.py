"""La propuesta de presupuesto anual, en Excel.

Toma lo que calculó `services/presupuesto.py` — no recalcula nada: la pantalla
y este archivo tienen que decir lo mismo siempre.

Los totales van por fórmula, como en el resto del libro: si alguien ajusta un
monto, los subtotales y el total se mueven con él. Un total pegado se
desincroniza en el primer ajuste y nadie se entera.
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
AMBAR = "FF8A5A00"
BANDA = "FFEAF0FA"
SUBTOT = "FFDCE6F4"
LEDGER = "FFFFF3CD"
GRIS = "FF787B86"
MONEDA = '"$"#,##0;[Red]-"$"#,##0;"—"'
MEDIO = Side(style="medium", color="FF9AA4B2")
BLANCO = Font(bold=True, color="FFFFFFFF", size=9)


def propuesta_a_xlsx(d: dict[str, Any]) -> bytes:
    anio = d["anio"]
    semanas: list[str] = d["semanas"]
    filas: list[dict[str, Any]] = d["filas"]
    habito: dict[str, Any] = d["habito"]

    wb = Workbook()
    ws = wb.active
    ws.title = f"Propuesta {anio}"
    ws.sheet_view.showGridLines = False

    FIJ = ["NO. PROYECTO", "TAREA", "CATEGORÍA", "ORIGEN", "REMANENTE",
           f"PLAN ACTUAL {anio}", f"PROPUESTA {anio}", "DIFERENCIA"]
    C0 = len(FIJ) + 1
    C_TOT = C0 + len(semanas)

    ws["A1"] = f"PRESUPUESTO {anio} — VENTANAS · propuesta semanal"
    ws["A1"].font = Font(bold=True, size=16, color=TEAL)
    ws["A2"] = (
        "Hitos: del cronograma ya cargado.  ·  Hábito: del historial del LEDGER "
        "(monto típico y semana del mes en que se paga)."
    )
    ws["A2"].font = Font(size=10, color=GRIS)
    ws["A3"] = (
        f"Generado {dt.date.today():%d/%m/%Y} · propuesta para revisar — "
        "no cambia nada en el sistema"
    )
    ws["A3"].font = Font(size=9, italic=True, color=GRIS)

    hr = 6
    for i, h in enumerate(FIJ, 1):
        c = ws.cell(hr, i, h)
        c.fill = PatternFill("solid", fgColor=TEAL)
        c.font = BLANCO
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    for j, w in enumerate(semanas):
        c = ws.cell(hr, C0 + j, dt.date.fromisoformat(w))
        c.number_format = "dd-mmm"
        c.fill = PatternFill("solid", fgColor=TEAL)
        c.font = Font(bold=True, color="FFFFFFFF", size=8)
        c.alignment = Alignment(horizontal="center", text_rotation=90)
    t = ws.cell(hr, C_TOT, f"TOTAL {anio}")
    t.fill = PatternFill("solid", fgColor=AMBAR)
    t.font = BLANCO
    t.alignment = Alignment(horizontal="center", wrap_text=True)
    ws.row_dimensions[hr].height = 54

    por_cat: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in filas:
        por_cat[f["category"]].append(f)

    r = hr + 1
    subs: list[int] = []
    for cat, ls in por_cat.items():
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=C_TOT)
        b = ws.cell(r, 1, cat.upper())
        b.fill = PatternFill("solid", fgColor=BANDA)
        b.font = Font(bold=True, size=10, color=TEAL)
        r += 1
        ini = r
        for f in ls:
            esLedger = f["origen"] == "ledger"
            ws.cell(r, 1, f["wbs_code"]).font = Font(name="Consolas", size=9)
            ws.cell(r, 2, f["title"]).alignment = Alignment(wrap_text=True, vertical="top")
            ws.cell(r, 3, f["category"])
            o = ws.cell(r, 4, "LEDGER (hábito)" if esLedger else "Cronograma (hito)")
            if esLedger:
                o.fill = PatternFill("solid", fgColor=LEDGER)
                o.font = Font(bold=True, color=AMBAR, size=9)
            ws.cell(r, 5, f["remaining"]).number_format = MONEDA
            ws.cell(r, 6, f["plan_total"]).number_format = MONEDA
            ws.cell(r, 7, f"=SUM({gc(C0)}{r}:{gc(C_TOT - 1)}{r})").number_format = MONEDA
            ws.cell(r, 8, f"={gc(7)}{r}-{gc(6)}{r}").number_format = MONEDA
            for j, w in enumerate(semanas):
                v = f["propuesta"].get(w)
                cel = ws.cell(r, C0 + j, v if v else None)
                cel.number_format = MONEDA
                if v and esLedger:
                    cel.fill = PatternFill("solid", fgColor=LEDGER)
            ws.cell(r, C_TOT, f"={gc(7)}{r}").number_format = MONEDA
            ws.cell(r, C_TOT).font = Font(bold=True)
            r += 1
        fin = r - 1
        for i in range(1, C_TOT + 1):
            cc = ws.cell(r, i)
            cc.fill = PatternFill("solid", fgColor=SUBTOT)
            cc.border = Border(top=MEDIO, bottom=MEDIO)
        ws.cell(r, 2, f"Subtotal {cat}").font = Font(bold=True)
        for col in [5, 6, 7, 8, *range(C0, C_TOT + 1)]:
            cc = ws.cell(r, col, f"=SUM({gc(col)}{ini}:{gc(col)}{fin})")
            cc.number_format = MONEDA
            cc.font = Font(bold=True)
        subs.append(r)
        r += 2

    tot = r
    for i in range(1, C_TOT + 1):
        ws.cell(tot, i).fill = PatternFill("solid", fgColor=TEAL)
    ws.cell(tot, 2, f"TOTAL {anio}").font = Font(bold=True, size=11, color="FFFFFFFF")
    for col in [5, 6, 7, 8, *range(C0, C_TOT + 1)]:
        ref = ",".join(f"{gc(col)}{x}" for x in subs)
        cc = ws.cell(tot, col, f"=SUM({ref})" if subs else 0)
        cc.number_format = MONEDA
        cc.font = Font(bold=True, size=11, color="FFFFFFFF")

    for col, w in ((1, 12), (2, 42), (3, 18), (4, 18), (5, 15), (6, 16), (7, 16), (8, 15)):
        ws.column_dimensions[gc(col)].width = w
    for j in range(len(semanas)):
        ws.column_dimensions[gc(C0 + j)].width = 10
    ws.column_dimensions[gc(C_TOT)].width = 15
    ws.freeze_panes = f"{gc(C0)}{hr + 1}"
    ws.auto_filter.ref = f"A{hr}:{gc(C_TOT)}{tot - 1}"
    ws.print_title_rows = f"{hr}:{hr}"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True

    # ── Hoja 2: de dónde sale cada número de hábito ────────────────────────
    h2 = wb.create_sheet("Base del cálculo")
    h2.sheet_view.showGridLines = False
    h2["A1"] = "DE DÓNDE SALE CADA NÚMERO DE HÁBITO"
    h2["A1"].font = Font(bold=True, size=14, color=TEAL)
    h2["A2"] = (
        "Cada pago real del LEDGER, mes a mes. El monto propuesto es la MEDIANA "
        "— no el promedio: un pago doble o un mes salteado corren el promedio y "
        "dejan de describir lo típico."
    )
    h2["A2"].font = Font(size=10, color=GRIS)
    h2["A2"].alignment = Alignment(wrap_text=True)
    h2.row_dimensions[2].height = 30

    titulos = {f["wbs_code"]: f["title"] for f in filas}
    rem = {f["wbs_code"]: f["remaining"] for f in filas}
    f2 = 4
    for code, hb in habito.items():
        h2.cell(f2, 1, f"{code} — {titulos.get(code, '')}").font = Font(bold=True, size=11)
        f2 += 1
        meses = (rem.get(code, 0) / hb["mensual"]) if hb["mensual"] else 0
        for et, va, fm in (
            ("Propuesto por mes", hb["mensual"], MONEDA),
            ("Semana del mes", f"semana {hb['semana_del_mes']}", None),
            (f"Propuesto {anio} (12 meses)", hb["mensual"] * 12, MONEDA),
            ("Remanente del presupuesto", rem.get(code, 0), MONEDA),
            ("Meses que cubre el remanente", round(meses, 1), "0.0"),
            ("Meses con pago en el historial", hb["meses_con_pago"], "0"),
        ):
            h2.cell(f2, 1, et).font = Font(size=9, color=GRIS)
            c = h2.cell(f2, 2, va)
            if fm:
                c.number_format = fm
            c.font = Font(bold=True)
            f2 += 1
        h2.cell(f2, 1, "Historial del LEDGER").font = Font(size=9, bold=True, color=AMBAR)
        f2 += 1
        for p in hb["historial"]:
            h2.cell(f2, 1, p["mes"]).alignment = Alignment(horizontal="right")
            h2.cell(f2, 2, p["monto"]).number_format = MONEDA
            f2 += 1
        f2 += 2
    for col, w in ((1, 32), (2, 18), (3, 14)):
        h2.column_dimensions[gc(col)].width = w

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
