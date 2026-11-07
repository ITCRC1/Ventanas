"""Planning → Excel.

La misma tabla del tab Planning, bajada como libro: por número de proyecto, el
presupuesto, lo gastado, lo que queda, el plan mes a mes de la ventana elegida y
las anotaciones de revisión (nota, monto sugerido, mover-a-mes).

Dos decisiones que vale la pena dejar escritas:

* **Los totales son fórmulas, no números pegados.** Es el mismo criterio del
  Master File: si alguien cambia un monto en el Excel, los subtotales y el gran
  total se mueven con él. Un total pegado se desincroniza en el primer ajuste y
  nadie se entera.

* **La ventana de meses manda.** Las columnas de mes son las que se eligieron en
  pantalla, y la columna "Plan" es su suma — no un campo guardado. Así el
  archivo dice exactamente lo que decía la pantalla cuando se bajó.
"""

from __future__ import annotations

import datetime as dt
import io
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as gc
from openpyxl.worksheet.pagebreak import Break

# Paleta: la de la app. El verde azulado de la barra, el ámbar de la banda de
# anotaciones y el verde claro de la columna del plan.
TEAL = "FF0F5F59"
TEAL_SUAVE = "FFE2F0EE"
AMBAR = "FF8A5A00"
AMBAR_SUAVE = "FFFBF3E3"
PLAN_FILL = "FFD9F2E6"
BANDA = "FFEAF0FA"
SUBTOTAL = "FFDCE6F4"
GRIS = "FF787B86"
BLANCO = Font(bold=True, color="FFFFFFFF", size=9)

MONEDA = '"$"#,##0;[Red]-"$"#,##0'
FINO = Side(style="thin", color="FFD0D5DD")
MEDIO = Side(style="medium", color="FF9AA4B2")

MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun",
             "jul", "ago", "set", "oct", "nov", "dic"]


def etiqueta_mes(ym: str) -> str:
    """'2026-11' -> \"NOV '26\" — igual que la pantalla."""
    y, m = int(ym[:4]), int(ym[5:7])
    return f"{MES_CORTO[m - 1].upper()} '{y % 100:02d}"


def _num(x: Any) -> float:
    try:
        return float(x or 0)
    except (TypeError, ValueError):
        return 0.0


def _clave_codigo(code: str) -> list[int]:
    """'1.10.2' -> [1, 10, 2], para ordenar como número y no como texto."""
    out = []
    for p in str(code).split("."):
        try:
            out.append(int(p))
        except ValueError:
            out.append(0)
    return out


def planning_to_xlsx(
    *,
    project_name: str | None,
    meses: list[str],
    filas: list[dict[str, Any]],
    notas: dict[int, dict[str, Any]],
    generado_por: str | None = None,
) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Planning"
    ws.sheet_view.showGridLines = False

    n_meses = len(meses)
    # 1 código · 2 tarea · 3 presupuesto · 4 gastado · 5 remanente
    # 6..(5+n) meses · plan · nota · sugerido · mover
    C_PLAN = 6 + n_meses
    C_NOTA = C_PLAN + 1
    C_SUG = C_PLAN + 2
    C_MOVER = C_PLAN + 3
    ULTIMA = C_MOVER

    ventana = (
        f"{etiqueta_mes(meses[0])} → {etiqueta_mes(meses[-1])}" if meses else "sin meses"
    )

    # ── Encabezado del documento ────────────────────────────────────────────
    ws["A1"] = f"PLANNING — {project_name or 'Ventanas'}"
    ws["A1"].font = Font(bold=True, size=16, color=TEAL)
    ws["A2"] = f"Gasto planeado por número de proyecto · {ventana}"
    ws["A2"].font = Font(size=10, color=GRIS)
    pie = f"Generado {dt.date.today():%d/%m/%Y}"
    if generado_por:
        pie += f" · {generado_por}"
    ws["A3"] = pie
    ws["A3"].font = Font(size=9, italic=True, color=GRIS)

    # ── Tarjetas de resumen (fórmulas: se mueven con la tabla) ──────────────
    hr = 7  # fila de encabezados de la tabla
    primera = hr + 1

    # ── Encabezados ─────────────────────────────────────────────────────────
    cabeceras = [
        (1, "NO. PROYECTO", TEAL, 14),
        (2, "TASK / PHASE", TEAL, 46),
        (3, "BUDGET", TEAL, 14),
        (4, "SPENT", TEAL, 14),
        (5, "REMAINING", TEAL, 14),
    ]
    for i, ym in enumerate(meses):
        cabeceras.append((6 + i, etiqueta_mes(ym), TEAL, 13))
    cabeceras += [
        (C_PLAN, f"PLAN {ventana}", AMBAR, 18),
        (C_NOTA, "NOTE", AMBAR, 38),
        (C_SUG, "SUGGESTED $", AMBAR, 14),
        (C_MOVER, "MOVE (FROM → TO)", AMBAR, 24),
    ]
    for col, texto, fondo, ancho in cabeceras:
        c = ws.cell(hr, col, texto)
        c.fill = PatternFill("solid", fgColor=fondo)
        c.font = BLANCO
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        c.border = Border(left=FINO, right=FINO, top=MEDIO, bottom=MEDIO)
        ws.column_dimensions[gc(col)].width = ancho
    ws.row_dimensions[hr].height = 30

    # ── Agrupar por categoría, ordenando el código como número ──────────────
    por_cat: dict[str, list[dict[str, Any]]] = {}
    for f in filas:
        por_cat.setdefault(f.get("category") or "Sin categoría", []).append(f)
    grupos = [
        (cat, sorted(ls, key=lambda r: _clave_codigo(r["wbs_code"])))
        for cat, ls in por_cat.items()
    ]
    grupos.sort(key=lambda g: _clave_codigo(g[1][0]["wbs_code"]) if g[1] else [0])

    r = primera
    filas_subtotal: list[int] = []
    for cat, ls in grupos:
        # Banda de categoría
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=ULTIMA)
        b = ws.cell(r, 1, str(cat).upper())
        b.fill = PatternFill("solid", fgColor=BANDA)
        b.font = Font(bold=True, size=10, color=TEAL)
        b.alignment = Alignment(vertical="center", indent=1)
        ws.row_dimensions[r].height = 18
        r += 1

        ini = r
        for f in ls:
            nota = notas.get(f["wbs_id"], {})
            ws.cell(r, 1, f["wbs_code"]).font = Font(name="Consolas", size=9)
            tarea = f.get("title") or ""
            if f.get("phase"):
                tarea = f"{tarea} · {f['phase']}"
            ws.cell(r, 2, tarea).alignment = Alignment(wrap_text=True, vertical="top")
            ws.cell(r, 3, _num(f.get("budget_revised"))).number_format = MONEDA
            ws.cell(r, 4, _num(f.get("spend"))).number_format = MONEDA
            ws.cell(r, 5, _num(f.get("remaining"))).number_format = MONEDA
            plan = f.get("planned") or {}
            for i, ym in enumerate(meses):
                v = _num(plan.get(ym))
                cel = ws.cell(r, 6 + i, v if v else None)
                cel.number_format = MONEDA
            # El plan de la ventana: SUMA de los meses, no un dato aparte.
            p = ws.cell(r, C_PLAN, f"=SUM({gc(6)}{r}:{gc(5 + n_meses)}{r})")
            p.number_format = MONEDA
            p.font = Font(bold=True)
            p.fill = PatternFill("solid", fgColor=PLAN_FILL)
            ws.cell(r, C_NOTA, nota.get("note") or "").alignment = Alignment(
                wrap_text=True, vertical="top"
            )
            sug = nota.get("suggested_amount")
            if sug is not None:
                ws.cell(r, C_SUG, _num(sug)).number_format = MONEDA
            mover = nota.get("move_to_month")
            con_plan = [etiqueta_mes(ym) for ym in meses if _num(plan.get(ym))]
            ws.cell(
                r,
                C_MOVER,
                f"{', '.join(con_plan)} → {etiqueta_mes(mover)}" if mover else "",
            ).alignment = Alignment(wrap_text=True, vertical="top")
            for col in range(1, ULTIMA + 1):
                ws.cell(r, col).border = Border(left=FINO, right=FINO, bottom=FINO)
            for col in (C_NOTA, C_SUG, C_MOVER):
                ws.cell(r, col).fill = PatternFill("solid", fgColor=AMBAR_SUAVE)
            r += 1
        fin = r - 1

        # Subtotal de la categoría
        for col in range(1, ULTIMA + 1):
            c = ws.cell(r, col)
            c.fill = PatternFill("solid", fgColor=SUBTOTAL)
            c.border = Border(top=MEDIO, bottom=MEDIO, left=FINO, right=FINO)
        s = ws.cell(r, 2, f"Subtotal {cat}")
        s.font = Font(bold=True, size=10)
        s.alignment = Alignment(indent=1)
        for col in [3, 4, 5, *range(6, 6 + n_meses), C_PLAN, C_SUG]:
            cel = ws.cell(r, col, f"=SUM({gc(col)}{ini}:{gc(col)}{fin})" if fin >= ini else 0)
            cel.number_format = MONEDA
            cel.font = Font(bold=True)
        filas_subtotal.append(r)
        r += 2

    # ── Gran total ──────────────────────────────────────────────────────────
    total = r
    for col in range(1, ULTIMA + 1):
        c = ws.cell(total, col)
        c.fill = PatternFill("solid", fgColor=TEAL)
        c.border = Border(top=MEDIO, bottom=MEDIO)
    g = ws.cell(total, 2, "TOTAL")
    g.font = Font(bold=True, size=11, color="FFFFFFFF")
    g.alignment = Alignment(indent=1)
    for col in [3, 4, 5, *range(6, 6 + n_meses), C_PLAN, C_SUG]:
        ref = ",".join(f"{gc(col)}{x}" for x in filas_subtotal)
        cel = ws.cell(total, col, f"=SUM({ref})" if filas_subtotal else 0)
        cel.number_format = MONEDA
        cel.font = Font(bold=True, size=11, color="FFFFFFFF")

    # ── Tarjetas de arriba: referencias vivas al gran total ─────────────────
    tarjetas = [
        (1, "PLANEADO EN LA VENTANA", f"={gc(C_PLAN)}{total}", MONEDA),
        (3, "PRESUPUESTO", f"={gc(3)}{total}", MONEDA),
        (4, "GASTADO", f"={gc(4)}{total}", MONEDA),
        (5, "REMANENTE", f"={gc(5)}{total}", MONEDA),
        (6, "NÚMEROS DE PROYECTO", len(filas), "#,##0"),
    ]
    for col, etq, valor, fmt in tarjetas:
        e = ws.cell(5, col, etq)
        e.font = Font(size=8, bold=True, color=GRIS)
        e.alignment = Alignment(horizontal="left" if col == 1 else "right")
        v = ws.cell(6, col, valor)
        v.number_format = fmt
        v.font = Font(bold=True, size=13, color=TEAL)
        v.alignment = Alignment(horizontal="left" if col == 1 else "right")

    # ── Vista y papel ───────────────────────────────────────────────────────
    ws.freeze_panes = f"{gc(6)}{primera}"
    ws.auto_filter.ref = f"A{hr}:{gc(ULTIMA)}{total - 1}"
    ws.print_title_rows = f"{hr}:{hr}"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = ws.page_margins.right = 0.3
    ws.oddFooter.center.text = "&P / &N"
    ws.oddFooter.center.size = 8
    ws.row_breaks.append(Break(id=total))

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
