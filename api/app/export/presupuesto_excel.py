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
    # ⚠️ `totales` y no `tot`: mas abajo `tot` es la FILA del gran total.
    # Con el mismo nombre, la fila pisaba el diccionario y la hoja Control
    # reventaba con "int object is not subscriptable".
    totales = d["totales"]

    wb = Workbook()
    ws = wb.active
    ws.title = f"Propuesta {anio}"
    ws.sheet_view.showGridLines = False

    # El Job Cost es el estandar: presupuesto, gastado y remanente primero,
    # y despues los cuatro tramos en que se reparte el remanente.
    FIJ = ["NO. PROYECTO", "TAREA", "CATEGORÍA", "PRESUPUESTO", "GASTADO",
           "REMANENTE", "VENCIDO", "ARRASTRE", f"PLAN {anio}",
           f"POSTERIOR A {anio}", f"PROPUESTA {anio}"]
    C0 = len(FIJ) + 1
    C_TOT = C0 + len(semanas)

    ws["A1"] = f"PRESUPUESTO {anio} — VENTANAS · propuesta semanal"
    ws["A1"].font = Font(bold=True, size=16, color=TEAL)
    ws["A2"] = (
        "El remanente de cada línea se reparte en VENCIDO (la semana ya pasó y "
        "sigue sin gastarse), ARRASTRE (de hoy a fin de año), PLAN (dentro del "
        f"año) y POSTERIOR.  Propuesta {anio} = vencido + arrastre + plan."
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
            ws.cell(r, 1, f["wbs_code"]).font = Font(name="Consolas", size=9)
            ws.cell(r, 2, f["title"]).alignment = Alignment(wrap_text=True, vertical="top")
            ws.cell(r, 3, f["category"])
            for col, k in ((4, "budget_revised"), (5, "spend"), (6, "remaining"),
                           (7, "vencido"), (8, "arrastre"), (9, "plan_total"),
                           (10, "posterior")):
                cel = ws.cell(r, col, f[k])
                cel.number_format = MONEDA
                if col == 7 and f["vencido"]:
                    cel.fill = PatternFill("solid", fgColor="FFF4CCCC")
                    cel.font = Font(bold=True, color="FF9C0006")
                elif col == 8 and f["arrastre"]:
                    cel.fill = PatternFill("solid", fgColor=LEDGER)
            # La propuesta es la suma de sus propias semanas: si se ajusta una
            # celda, el total se mueve con ella.
            p = ws.cell(r, 11, f"=SUM({gc(C0)}{r}:{gc(C_TOT - 1)}{r})")
            p.number_format = MONEDA
            p.font = Font(bold=True)
            for j, w in enumerate(semanas):
                v = f["propuesta"].get(w)
                ws.cell(r, C0 + j, v if v else None).number_format = MONEDA
            ws.cell(r, C_TOT, f"={gc(11)}{r}").number_format = MONEDA
            ws.cell(r, C_TOT).font = Font(bold=True)
            r += 1
        fin = r - 1
        for i in range(1, C_TOT + 1):
            cc = ws.cell(r, i)
            cc.fill = PatternFill("solid", fgColor=SUBTOT)
            cc.border = Border(top=MEDIO, bottom=MEDIO)
        ws.cell(r, 2, f"Subtotal {cat}").font = Font(bold=True)
        for col in [*range(4, 12), *range(C0, C_TOT + 1)]:
            cc = ws.cell(r, col, f"=SUM({gc(col)}{ini}:{gc(col)}{fin})")
            cc.number_format = MONEDA
            cc.font = Font(bold=True)
        subs.append(r)
        r += 2

    tot = r
    for i in range(1, C_TOT + 1):
        ws.cell(tot, i).fill = PatternFill("solid", fgColor=TEAL)
    ws.cell(tot, 2, f"TOTAL {anio}").font = Font(bold=True, size=11, color="FFFFFFFF")
    for col in [*range(4, 12), *range(C0, C_TOT + 1)]:
        ref = ",".join(f"{gc(col)}{x}" for x in subs)
        cc = ws.cell(tot, col, f"=SUM({ref})" if subs else 0)
        cc.number_format = MONEDA
        cc.font = Font(bold=True, size=11, color="FFFFFFFF")

    for col, w in ((1, 12), (2, 42), (3, 18), (4, 15), (5, 15), (6, 15),
                   (7, 14), (8, 14), (9, 14), (10, 15), (11, 16)):
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

    # ── Hoja 2: el control de que los tramos cierren ───────────────────────
    h2 = wb.create_sheet("Control")
    h2.sheet_view.showGridLines = False
    h2["A1"] = "EL REMANENTE, REPARTIDO"
    h2["A1"].font = Font(bold=True, size=14, color=TEAL)
    h2["A2"] = (
        "Los cuatro tramos tienen que sumar el remanente del Job Cost. Si "
        "«Sin ubicar» no es cero, hay plata pendiente que el cronograma no pone "
        "en ningún año — y entonces el presupuesto está incompleto."
    )
    h2["A2"].font = Font(size=10, color=GRIS)
    h2["A2"].alignment = Alignment(wrap_text=True)
    h2.row_dimensions[2].height = 30
    f2 = 4
    for et, k in (
        ("Presupuesto revisado", "budget_revised"),
        ("Gastado", "spend"),
        ("REMANENTE", "remanente"),
        ("", None),
        ("Vencido — la semana ya pasó", "vencido"),
        ("Arrastre — de hoy a fin de año", "arrastre"),
        (f"Plan {anio}", "plan"),
        (f"Posterior a {anio}", "posterior"),
        ("", None),
        ("Sin ubicar (tiene que ser 0)", "sin_ubicar"),
        ("", None),
        (f"PROPUESTA {anio} = vencido + arrastre + plan", "propuesta"),
        ("Líneas del Job Cost", "lineas"),
    ):
        if k is None:
            f2 += 1
            continue
        h2.cell(f2, 1, et).font = Font(size=10, color=GRIS)
        c = h2.cell(f2, 2, totales[k])
        c.number_format = "#,##0" if k == "lineas" else MONEDA
        c.font = Font(bold=True, size=11)
        if k == "sin_ubicar" and abs(totales[k]) > 5:
            c.fill = PatternFill("solid", fgColor="FFF4CCCC")
            c.font = Font(bold=True, size=11, color="FF9C0006")
        f2 += 1
    for col, w in ((1, 42), (2, 20)):
        h2.column_dimensions[gc(col)].width = w

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
