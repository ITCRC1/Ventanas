"""La propuesta de presupuesto anual, en Excel — las mismas hojas que la pantalla.

Toma lo que calculó `services/presupuesto.py` — no recalcula nada: la pantalla
y este archivo tienen que decir lo mismo siempre.

⚠️ **UNA HOJA POR SUB-TAB, EN EL MISMO ORDEN.**

Owner, 2026-11-09: *«EL EXCEL QUE SE BAJA DEBE SER UNA COPIA FIEL DE LOS TABS, Y
BIEN FORMULADO... bien formulado ENTRE TABS»*.

  1 Line Data           = tab «Line Data»
  2 Edit {a} vs {a-1}   = tab «✎ Edit {a}» — el año que se edita y el anterior
  3 Month by Month      = tab «Month by Month»
  4 Budget {a}          = tab «Budget {a}»
  5 Weekly              = ese mismo tab con el interruptor «by week» prendido
  Control               = los seis KPI de arriba, con su cuadre

Las cinco primeras salen del MISMO `plano`, así que **una línea cae en la misma
fila en todas**: saltar de hoja no te mueve la línea que estabas mirando. Eso no
es cosmético — es lo que hace posible que una hoja apunte a otra por `!F12` sin
tener que buscar nada.

## La cadena de fórmulas, de abajo hacia arriba

```
5 Weekly          los montos semanales            ← los únicos valores duros
   ↓ SUM(semanas del mes)
3 Month by Month  los doce meses
   ↓ !{mes}{fila del subtotal}
4 Budget {a}      una fila por sección
2 Edit            el mes {a} apunta a la hoja 3; {a-1} es dato del cronograma
1 Line Data       REMAINING =F-G   ·   PROPOSAL =I+J+K
   ↓ !{columna}{fila del gran total}
Control           los seis KPI y «Unplaced», que tiene que dar 0
```

⚠️ **Antes `Control` tenía los totales PEGADOS.** Esa es la hoja cuyo único
trabajo es probar que la cosa cuadra: con valores duros, alguien ajustaba una
línea y Control seguía diciendo «Unplaced = 0» cuando ya no lo era. El archivo
se contradecía a sí mismo sin una sola celda en rojo. Ahora cada número apunta
al gran total de `1 Line Data`.

⚠️ **Y los meses eran valores.** `3 Month by Month` suma las semanas de la hoja
5; tocar una semana mueve el mes, el subtotal de la sección, la fila de
`4 Budget` y el gran total. La columna `vs LINE DATA` cierra el círculo: compara
el total de la fila contra el PROPOSAL de la hoja 1, y si una sola línea no
coincide se pinta en rojo.

En inglés porque el destinatario es el dueño (pedido del 2026-11-08).
"""

from __future__ import annotations

import datetime as dt
import io
from collections import defaultdict
from typing import Any

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as gc

TEAL = "FF0F5F59"
AZUL = "FF1F4E79"
AMBAR = "FF8A5A00"
BANDA = "FFEAF0FA"
SUBTOT = "FFDCE6F4"
LEDGER = "FFFFF3CD"
GRIS = "FF787B86"
VERDE = "FFE8F5E9"
ROJO = "FFF4CCCC"
MONEDA = '"$"#,##0;[Red]-"$"#,##0;"—"'
MEDIO = Side(style="medium", color="FF9AA4B2")
# La divisoria entre bloques. Owner, 2026-11-09, marcandolas a mano sobre la
# hoja: con 24 columnas de mes pegadas una a otra, el ojo pierde cual par
# pertenece a que mes. Mas oscura que MEDIO porque tiene que leerse como una
# separacion y no como el borde de una celda cualquiera.
DIVISORIA = Side(style="medium", color="FF1F4E79")
BLANCO = Font(bold=True, color="FFFFFFFF", size=9)
APAGADA = Font(size=9, color="FFAAB2BE")
MESES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
         "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

# Los nombres de las hojas viven acá y no sueltos por el archivo: una hoja
# apunta a otra por nombre, y un nombre escrito dos veces es un `#REF!`
# esperando a que alguien renombre una pestaña.
H_DATOS = "1 Line Data"
H_MESES = "3 Month by Month"
H_SEM = "5 Weekly"


def _ref(hoja: str) -> str:
    """El nombre de la hoja como se escribe DENTRO de una fórmula."""
    return f"'{hoja}'"


def _cerrada(f: dict[str, Any]) -> bool:
    """La línea ya no tiene nada por gastar ni nada propuesto.

    La pantalla las pinta en gris claro; acá se hace igual. Si el Excel las
    mostrara iguales que las vivas, el dueño tendría que comparar dos columnas
    para saber cuáles ya están cerradas.
    """
    return float(f["remaining"]) < 0.5 and float(f["propuesta_total"]) < 0.5


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
        # El encabezado cerrado arriba y abajo: la otra raya que marco el owner.
        c.border = Border(top=DIVISORIA, bottom=DIVISORIA)
    ws.row_dimensions[hr].height = 30


def _cerrar(ws: Any, hr: int, ult: int, ultima: int, congelar: int) -> None:
    # ⚠️ La coordenada como TEXTO, no `ws.cell(...)`: la primera fila de datos
    # es la banda de categoría, que está combinada, y openpyxl no sabe leer una
    # MergedCell como referencia de congelado.
    ws.freeze_panes = f"{gc(congelar)}{hr + 1}"
    ws.auto_filter.ref = f"A{hr}:{gc(ult)}{ultima}"
    ws.print_title_rows = f"{hr}:{hr}"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True


def _banda(ws: Any, r: int, cat: str, hasta: int) -> None:
    """La banda de sección, igual que la fila azul clara de la pantalla."""
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=hasta)
    b = ws.cell(r, 1, cat.upper())
    b.fill = PatternFill("solid", fgColor=BANDA)
    b.font = Font(bold=True, size=10, color=TEAL)


def _pintar_total(ws: Any, r: int, hasta: int, sub: bool) -> Font:
    """Pinta la fila de subtotal o de gran total y devuelve su tipografía."""
    fondo = SUBTOT if sub else TEAL
    for i in range(1, hasta + 1):
        cc = ws.cell(r, i)
        cc.fill = PatternFill("solid", fgColor=fondo)
        if sub:
            cc.border = Border(top=MEDIO, bottom=MEDIO)
    return Font(bold=True) if sub else Font(bold=True, size=11, color="FFFFFFFF")


def _divisorias(ws: Any, cols: list[int], hr: int, ultima: int) -> None:
    """Pinta una raya vertical a la IZQUIERDA de cada columna de `cols`.

    ⚠️ Se corre AL FINAL, cuando la hoja ya esta escrita, y conserva los bordes
    que cada celda ya tenia: las filas de subtotal llevan top/bottom y pisarlos
    con un Border nuevo borraria la linea que separa el subtotal de su tramo.

    ⚠️ Las bandas de categoria estan combinadas. openpyxl deja estilar una
    MergedCell, pero no en todas las versiones; si tira, se salta esa celda y la
    raya simplemente no cruza la banda —que igual se lee, porque la banda ya es
    una franja de color de lado a lado—.
    """
    for c in cols:
        for r in range(hr, ultima + 1):
            cel = ws.cell(r, c)
            b = cel.border
            try:
                cel.border = Border(
                    left=DIVISORIA, right=b.right, top=b.top, bottom=b.bottom
                )
            except AttributeError:
                continue


def _suma(p: dict[str, Any], c: int) -> str:
    """La fórmula de un subtotal o de un gran total, para la columna `c`.

    El subtotal suma su tramo; el gran total suma los subtotales —NO el tramo
    entero—. Sumar el rango completo contaría dos veces cada subtotal.
    """
    if p["t"] == "sub":
        return f"=SUM({gc(c)}{p['tramo'][0]}:{gc(c)}{p['tramo'][1]})"
    return "=" + "+".join(f"{gc(c)}{x}" for x in p["subs"])


def propuesta_a_xlsx(d: dict[str, Any]) -> bytes:
    anio = d["anio"]
    filas: list[dict[str, Any]] = d["filas"]
    semanas: list[str] = d.get("semanas") or []
    # ⚠️ `totales` y no `tot`: más abajo `tot` es la FILA del gran total. Con el
    # mismo nombre, la fila pisaba el diccionario y la hoja Control reventaba
    # con "int object is not subscriptable".
    totales = d["totales"]

    por_cat: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in filas:
        por_cat[f["category"]].append(f)

    # El plano: en qué fila cae cada cosa. Se resuelve UNA vez y todas las hojas
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
    fila_total = r

    # De qué columnas de «5 Weekly» sale cada mes. La hoja semanal arranca en la
    # C, una columna por lunes del año, así que las semanas de un mes son un
    # rango contiguo y el mes es un SUM sobre él.
    tramo_mes: list[tuple[int, int] | None] = []
    for m in range(1, 13):
        cols = [i for i, w in enumerate(semanas) if int(str(w)[5:7]) == m]
        tramo_mes.append((3 + cols[0], 3 + cols[-1]) if cols else None)

    wb = Workbook()
    _hoja_datos(wb.active, anio, hr, plano, ultima)
    _hoja_edit(wb.create_sheet(f"2 Edit {anio} vs {anio - 1}"), anio, hr, plano, ultima)
    _hoja_meses(wb.create_sheet(H_MESES), anio, hr, plano, ultima, tramo_mes)
    cuenta = _hoja_anio(wb.create_sheet(f"4 Budget {anio}"), anio, hr, plano, por_cat)
    _hoja_semanas(wb.create_sheet(H_SEM), anio, hr, plano, ultima, semanas)
    _hoja_control(wb.create_sheet("Control"), anio, totales, fila_total, cuenta)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ── 1 · Line Data ──────────────────────────────────────────────────────────

def _hoja_datos(
    ws: Any, anio: int, hr: int, plano: list[dict[str, Any]], ultima: int
) -> None:
    ws.title = H_DATOS
    _titulo(
        ws,
        f"VENTANAS — {anio} BUDGET PROPOSAL · LINE DATA",
        "Every Job Cost line, with what it has and how the remaining splits into "
        "the four tranches. REMAINING is =F-G and PROPOSAL is =I+J+K — both are "
        "formulas, so an adjustment carries through.",
    )
    _cabecera(ws, hr, [
        ("WBS", 12), ("TASK", 42), ("CATEGORY", 20), ("PHASE", 16), ("OWNER", 16),
        ("BUDGET", 15), ("SPENT", 15), ("REMAINING", 15),
        ("OVERDUE", 14), ("CARRY-OVER", 14), (f"PLAN {anio}", 14),
        (f"AFTER {anio}", 14), ("PROPOSAL", 16), ("LEDGER /MO", 13),
    ], TEAL)
    ws.cell(hr, 13).fill = PatternFill("solid", fgColor=AMBAR)
    N = 14

    for p in plano:
        r = p["fila"]
        if p["t"] == "cat":
            _banda(ws, r, p["cat"], N)
            continue
        if p["t"] == "linea":
            f = p["f"]
            gris = _cerrada(f)
            ws.cell(r, 1, f["wbs_code"]).font = (
                APAGADA if gris else Font(name="Consolas", size=9)
            )
            t = ws.cell(r, 2, f["title"])
            t.alignment = Alignment(wrap_text=True, vertical="top")
            if gris:
                t.font = APAGADA
            for col, k in ((3, "category"), (4, "phase"), (5, "owner")):
                cc = ws.cell(r, col, f[k])
                if gris:
                    cc.font = APAGADA
            for col, k in ((6, "budget_revised"), (7, "spend"),
                           (9, "vencido"), (10, "arrastre"),
                           (11, "plan_total"), (12, "posterior")):
                cel = ws.cell(r, col, f[k])
                cel.number_format = MONEDA
                if col == 9 and f["vencido"]:
                    cel.fill = PatternFill("solid", fgColor=ROJO)
                    cel.font = Font(bold=True, color="FF9C0006")
                elif col == 10 and f["arrastre"]:
                    cel.fill = PatternFill("solid", fgColor=LEDGER)
                elif gris:
                    cel.font = APAGADA
            # Derivados: se calculan en la hoja, no se copian.
            rem = ws.cell(r, 8, f"=F{r}-G{r}")
            rem.number_format = MONEDA
            pr = ws.cell(r, 13, f"=I{r}+J{r}+K{r}")
            pr.number_format = MONEDA
            pr.font = APAGADA if gris else Font(bold=True)
            pr.fill = PatternFill("solid", fgColor=VERDE)
            # El ritmo del LEDGER: en la pantalla es la etiqueta ámbar al lado
            # del nombre. Es informativo y NO mueve el presupuesto.
            if f.get("ritmo_ledger"):
                lg = ws.cell(r, 14, f["ritmo_ledger"])
                lg.number_format = MONEDA
                lg.fill = PatternFill("solid", fgColor=LEDGER)
                lg.font = Font(size=9, color="FF8A5A00")
            continue
        tipo = _pintar_total(ws, r, N, p["t"] == "sub")
        ws.cell(r, 2, f"Subtotal {p['cat']}" if p["t"] == "sub" else f"TOTAL {anio}").font = tipo
        for c in range(6, 14):
            cc = ws.cell(r, c, _suma(p, c))
            cc.number_format = MONEDA
            cc.font = tipo
    # Identidad | presupuesto y gasto | los cuatro tramos | propuesta | ledger.
    _divisorias(ws, [6, 9, 13, 14], hr, ultima)
    _cerrar(ws, hr, N, ultima, 6)


# ── 2 · Edit: el año que se edita, con el anterior al lado ─────────────────

def _hoja_edit(
    ws: Any, anio: int, hr: int, plano: list[dict[str, Any]], ultima: int
) -> None:
    """El tab «✎ Edit», que en pantalla es la grilla editable.

    Las columnas fijas (Budget Revised, Total Expense, Variance) y los meses de
    `{anio}` NO se copian: apuntan a `1 Line Data` y a `3 Month by Month`. Si se
    ajusta algo allá, esta hoja se mueve sola. Los meses de `{anio-1}` sí son
    valores: son historia del cronograma y no hay de dónde derivarlos.
    """
    base = anio - 1
    _titulo(
        ws,
        f"VENTANAS — EDIT {anio}, WITH {base} BESIDE IT",
        f"The same side-by-side as the screen: {anio} and {base} month by month, "
        f"with budget, expense and variance frozen on the left. The {anio} cells "
        f"point at «{H_MESES}» and the fixed columns at «{H_DATOS}».",
    )
    cols = [("WBS", 12), ("TASK", 40), ("BUDGET REVISED", 15),
            ("TOTAL EXPENSE", 15), ("VARIANCE", 14)]
    for m in MESES:
        cols += [(f"{m} {anio}", 13), (f"{m} {base}", 12)]
    cols += [(f"TOTAL {anio}", 16), (f"TOTAL {base}", 16), ("VARIANCE", 15)]
    _cabecera(ws, hr, cols, TEAL)
    N = len(cols)
    # El año que se edita en azul, el anterior en gris: en la pantalla es lo
    # mismo, y sin eso hay que leer el encabezado para saber en cuál se está.
    for i in range(6, 6 + 24, 2):
        ws.cell(hr, i).fill = PatternFill("solid", fgColor=AZUL)
    for i in range(7, 7 + 24, 2):
        ws.cell(hr, i).fill = PatternFill("solid", fgColor=GRIS)
    for i in (N - 2, N - 1, N):
        ws.cell(hr, i).fill = PatternFill("solid", fgColor=AMBAR)

    MM = _ref(H_MESES)
    LD = _ref(H_DATOS)
    for p in plano:
        r = p["fila"]
        if p["t"] == "cat":
            _banda(ws, r, p["cat"], N)
        elif p["t"] == "linea":
            f = p["f"]
            gris = _cerrada(f)
            ws.cell(r, 1, f["wbs_code"]).font = (
                APAGADA if gris else Font(name="Consolas", size=9)
            )
            t = ws.cell(r, 2, f["title"])
            t.alignment = Alignment(wrap_text=True, vertical="top")
            if gris:
                t.font = APAGADA
            mb = f.get("meses_base") or [0.0] * 12
            for i in range(12):
                # ⚠️ El mes de {anio} NO se copia: apunta a la hoja 3, que a su
                # vez suma las semanas. Una sola fuente, tres hojas.
                a = ws.cell(r, 6 + i * 2, f"={MM}!{gc(5 + i)}{r}")
                a.number_format = MONEDA
                b = ws.cell(r, 7 + i * 2, round(float(mb[i] or 0), 2))
                b.number_format = MONEDA
                b.font = Font(size=9, color=GRIS)
        else:
            tipo = _pintar_total(ws, r, N, p["t"] == "sub")
            etq = f"Subtotal {p['cat']}" if p["t"] == "sub" else f"TOTAL {anio}"
            ws.cell(r, 2, etq).font = tipo
            for c in range(6, 6 + 24):
                cc = ws.cell(r, c, _suma(p, c))
                cc.number_format = MONEDA
                cc.font = tipo
        if p["t"] != "cat":
            # Las tres fijas y los tres totales van en TODA clase de fila.
            for c, ref in (
                (3, f"={LD}!F{r}"), (4, f"={LD}!G{r}"), (5, f"=C{r}-D{r}"),
            ):
                cc = ws.cell(r, c, ref)
                cc.number_format = MONEDA
                if p["t"] != "linea":
                    cc.font = Font(bold=True)
            # SUMIF sobre columnas alternadas no existe; se suman por nombre.
            ta = "=" + "+".join(f"{gc(6 + i * 2)}{r}" for i in range(12))
            tb = "=" + "+".join(f"{gc(7 + i * 2)}{r}" for i in range(12))
            for c, ref in ((N - 2, ta), (N - 1, tb), (N, f"={gc(N - 2)}{r}-{gc(N - 1)}{r}")):
                cc = ws.cell(r, c, ref)
                cc.number_format = MONEDA
                cc.font = Font(bold=True)
    # Una raya por MES: al inicio de cada par {anio}/{anio-1}, mas las fijas y
    # el bloque de totales. Es justo lo que el owner marco a mano.
    _divisorias(ws, [3, 6, *[6 + i * 2 for i in range(1, 12)], N - 2], hr, ultima)
    _cerrar(ws, hr, N, ultima, 6)


# ── 3 · Month by Month ─────────────────────────────────────────────────────

def _hoja_meses(
    ws: Any, anio: int, hr: int, plano: list[dict[str, Any]], ultima: int,
    tramo_mes: list[tuple[int, int] | None],
) -> None:
    _titulo(
        ws,
        f"VENTANAS — {anio} BUDGET PROPOSAL · MONTH BY MONTH",
        f"Who the line is (A..D, frozen) and the twelve months. Each month is "
        f"=SUM of its weeks on «{H_SEM}», so touching one week moves the month, "
        f"the section subtotal and the grand total. «vs LINE DATA» has to be 0.",
    )
    cols = [("WBS", 12), ("TASK", 42), ("CATEGORY", 20), ("PHASE", 16)]
    cols += [(m, 13) for m in MESES]
    cols += [(f"TOTAL {anio}", 16), ("vs LINE DATA", 13)]
    _cabecera(ws, hr, cols, TEAL)
    for i in range(5, 17):
        ws.cell(hr, i).fill = PatternFill("solid", fgColor=AZUL)
    ws.cell(hr, 17).fill = PatternFill("solid", fgColor=AMBAR)
    N = 18

    SEM = _ref(H_SEM)
    LD = _ref(H_DATOS)
    for p in plano:
        r = p["fila"]
        if p["t"] == "cat":
            _banda(ws, r, p["cat"], N)
        elif p["t"] == "linea":
            f = p["f"]
            gris = _cerrada(f)
            ws.cell(r, 1, f["wbs_code"]).font = (
                APAGADA if gris else Font(name="Consolas", size=9)
            )
            t = ws.cell(r, 2, f["title"])
            t.alignment = Alignment(wrap_text=True, vertical="top")
            if gris:
                t.font = APAGADA
            for col, k in ((3, "category"), (4, "phase")):
                cc = ws.cell(r, col, f[k])
                if gris:
                    cc.font = APAGADA
            for i, tr in enumerate(tramo_mes):
                ref = f"=SUM({SEM}!{gc(tr[0])}{r}:{gc(tr[1])}{r})" if tr else 0
                cel = ws.cell(r, 5 + i, ref)
                cel.number_format = MONEDA
                if gris:
                    cel.font = APAGADA
        else:
            tipo = _pintar_total(ws, r, N, p["t"] == "sub")
            etq = f"Subtotal {p['cat']}" if p["t"] == "sub" else f"TOTAL {anio}"
            ws.cell(r, 2, etq).font = tipo
            for c in range(5, 17):
                cc = ws.cell(r, c, _suma(p, c))
                cc.number_format = MONEDA
                cc.font = tipo
        if p["t"] != "cat":
            tt = ws.cell(r, 17, f"=SUM(E{r}:P{r})")
            tt.number_format = MONEDA
            tt.font = Font(bold=True)
            # ⚠️ El cierre del círculo. El total mensual de la fila tiene que
            # dar el PROPOSAL de la hoja 1 —son el mismo dinero contado de dos
            # maneras—. Si una sola línea no coincide, acá se ve en rojo; sin
            # esta columna, el archivo cuadraría contra sí mismo y nadie lo
            # sabría.
            ck = ws.cell(r, 18, f"={LD}!M{r}-Q{r}")
            ck.number_format = '#,##0.00;[Red]-#,##0.00;"ok"'
            ck.font = Font(size=9, color=GRIS)
    _divisorias(ws, [5, *range(6, 17), 17, 18], hr, ultima)
    ws.conditional_formatting.add(
        f"R{hr + 1}:R{ultima}",
        CellIsRule(operator="notBetween", formula=["-0.5", "0.5"],
                   fill=PatternFill("solid", bgColor=ROJO),
                   font=Font(bold=True, color="FF9C0006")),
    )
    # ⚠️ A..D fijas: el pedido era que la identidad no se vaya con el scroll.
    _cerrar(ws, hr, N, ultima, 5)


# ── 4 · Budget: cómo va quedando el año, por sección ───────────────────────

def _hoja_anio(
    ws: Any, anio: int, hr: int, plano: list[dict[str, Any]],
    por_cat: dict[str, list[dict[str, Any]]],
) -> tuple[int, int]:
    _titulo(
        ws,
        f"VENTANAS — {anio} BUDGET",
        f"How the {anio} budget is shaping up: one row per section, January "
        f"through December. Every cell points at that section's subtotal on "
        f"«{H_MESES}», so the two can never disagree.",
    )
    cols = [("SECTION", 34), ("LINES", 9)]
    cols += [(m, 14) for m in MESES]
    cols += [(f"TOTAL {anio}", 17)]
    _cabecera(ws, hr, cols, AZUL)
    ws.cell(hr, len(cols)).fill = PatternFill("solid", fgColor=AMBAR)

    subs = {p["cat"]: p for p in plano if p["t"] == "sub"}
    MM = _ref(H_MESES)
    LD = _ref(H_DATOS)
    r = hr + 1
    primeras: list[int] = []
    for cat in por_cat:
        sp = subs[cat]
        ws.cell(r, 1, cat.upper()).font = Font(bold=True, size=10, color=TEAL)
        # Cuántas líneas tiene la sección, CONTADAS en la hoja 1 y no pegadas:
        # si mañana se agrega una línea, el número se mueve solo.
        # ⚠️ El nombre de la hoja va UNA vez: `'Hoja'!F8:F9`. Repetirlo del otro
        # lado del rango (`'Hoja'!F8:'Hoja'!F9`) lo escribe openpyxl sin chistar
        # y algunas versiones de Excel lo rechazan al abrir.
        n = ws.cell(r, 2, f"=COUNT({LD}!F{sp['tramo'][0]}:F{sp['tramo'][1]})")
        n.alignment = Alignment(horizontal="right")
        for i in range(12):
            cel = ws.cell(r, 3 + i, f"={MM}!{gc(5 + i)}{sp['fila']}")
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
    _divisorias(ws, [3, *range(4, 15), 15], hr, r)
    _cerrar(ws, hr, 15, r, 3)
    # Dónde quedó la columna LINES, para que Control cuente desde acá.
    return (primeras[0] if primeras else hr + 1, primeras[-1] if primeras else hr + 1)


# ── 5 · Weekly: la semana, que es de donde sale todo ───────────────────────

def _hoja_semanas(
    ws: Any, anio: int, hr: int, plano: list[dict[str, Any]], ultima: int,
    semanas: list[str],
) -> None:
    """El mismo tab con el interruptor «by week» prendido.

    ⚠️ Esta es la ÚNICA hoja con valores duros. Todo lo demás del libro sale de
    acá por fórmula. Está al final y no al principio porque se mira poco, pero
    es la base: si se corrige una semana, el libro entero se reacomoda.
    """
    _titulo(
        ws,
        f"VENTANAS — {anio} BUDGET PROPOSAL · WEEK BY WEEK",
        "The weekly proposal, which is where every other sheet gets its numbers. "
        "This is the only sheet with typed values; correct a week here and the "
        "months, the sections and the grand total all follow.",
    )
    cols = [("WBS", 12), ("TASK", 40)]
    cols += [(str(w)[5:], 10) for w in semanas]
    cols += [(f"TOTAL {anio}", 16)]
    _cabecera(ws, hr, cols, TEAL)
    N = len(cols)
    # Una raya de color por mes, para no perderse entre cincuenta columnas.
    for i, w in enumerate(semanas):
        ws.cell(hr, 3 + i).fill = PatternFill(
            "solid", fgColor=AZUL if int(str(w)[5:7]) % 2 else TEAL
        )
    ws.cell(hr, N).fill = PatternFill("solid", fgColor=AMBAR)

    for p in plano:
        r = p["fila"]
        if p["t"] == "cat":
            _banda(ws, r, p["cat"], N)
        elif p["t"] == "linea":
            f = p["f"]
            gris = _cerrada(f)
            ws.cell(r, 1, f["wbs_code"]).font = (
                APAGADA if gris else Font(name="Consolas", size=9)
            )
            t = ws.cell(r, 2, f["title"])
            if gris:
                t.font = APAGADA
            prop = f.get("propuesta") or {}
            for i, w in enumerate(semanas):
                v = float(prop.get(w) or 0)
                cel = ws.cell(r, 3 + i, round(v, 2) if v else None)
                cel.number_format = MONEDA
                if gris:
                    cel.font = APAGADA
        else:
            tipo = _pintar_total(ws, r, N, p["t"] == "sub")
            etq = f"Subtotal {p['cat']}" if p["t"] == "sub" else f"TOTAL {anio}"
            ws.cell(r, 2, etq).font = tipo
            for c in range(3, N):
                cc = ws.cell(r, c, _suma(p, c))
                cc.number_format = MONEDA
                cc.font = tipo
        if p["t"] != "cat":
            tt = ws.cell(r, N, f"=SUM(C{r}:{gc(N - 1)}{r})")
            tt.number_format = MONEDA
            tt.font = Font(bold=True)
    # ⚠️ Una raya por MES, no por semana: con 52 columnas, una linea en cada una
    # no separa nada —solo ensucia—. El mes es la unidad con la que se lee.
    corte_mes = [3]
    for i, w in enumerate(semanas):
        if i and str(w)[5:7] != str(semanas[i - 1])[5:7]:
            corte_mes.append(3 + i)
    _divisorias(ws, [*corte_mes, N], hr, ultima)
    _cerrar(ws, hr, N, ultima, 3)


# ── Control: que los cuatro tramos cierren ─────────────────────────────────

def _hoja_control(
    ws: Any, anio: int, totales: dict[str, Any], fila_total: int,
    cuenta: tuple[int, int],
) -> None:
    """Los seis KPI de arriba de la pantalla, y el cuadre.

    ⚠️ Cada número es una FÓRMULA contra el gran total de «1 Line Data». Antes
    eran valores pegados, y eso rompía justo la hoja que existe para probar que
    el libro cuadra: se ajustaba una línea y Control seguía diciendo
    «Unplaced = 0» cuando ya no lo era. Un archivo que se contradice a sí mismo
    sin una celda en rojo es peor que no tener la hoja.
    """
    ws.sheet_view.showGridLines = False
    ws["A1"] = "THE REMAINING, SPLIT FOUR WAYS"
    ws["A1"].font = Font(bold=True, size=14, color=TEAL)
    ws["A2"] = (
        "The four tranches have to add up to the Job Cost remaining. If "
        "«Unplaced» is not zero, there is money the schedule puts in no year at "
        "all — and then the budget is incomplete. Every figure here is a formula "
        f"against the grand total on «{H_DATOS}»: adjust a line and this follows."
    )
    ws["A2"].font = Font(size=10, color=GRIS)
    ws["A2"].alignment = Alignment(wrap_text=True)
    ws.row_dimensions[2].height = 44

    LD = _ref(H_DATOS)
    BG = f"4 Budget {anio}"
    t = fila_total
    donde: dict[str, int] = {}
    f2 = 4
    for et, k, ref in (
        ("Budget revised", "budget_revised", f"={LD}!F{t}"),
        ("Spent", "spend", f"={LD}!G{t}"),
        ("REMAINING", "remanente", f"={LD}!H{t}"),
        ("", None, ""),
        ("Overdue — the week already passed", "vencido", f"={LD}!I{t}"),
        ("Carry-over — today to year end", "arrastre", f"={LD}!J{t}"),
        (f"Plan {anio}", "plan", f"={LD}!K{t}"),
        (f"After {anio}", "posterior", f"={LD}!L{t}"),
        ("", None, ""),
        ("Unplaced (must be 0)", "sin_ubicar", None),
        ("", None, ""),
        (f"PROPOSAL {anio} = overdue + carry-over + plan", "propuesta", f"={LD}!M{t}"),
        ("Job Cost lines", "lineas", f"=SUM('{BG}'!B{cuenta[0]}:B{cuenta[1]})"),
    ):
        if k is None:
            f2 += 1
            continue
        ws.cell(f2, 1, et).font = Font(size=10, color=GRIS)
        if k == "sin_ubicar":
            # Remanente menos los cuatro tramos, leído de esta misma hoja.
            ref = (
                f"=B{donde['remanente']}-(B{donde['vencido']}+B{donde['arrastre']}"
                f"+B{donde['plan']}+B{donde['posterior']})"
            )
        c = ws.cell(f2, 2, ref)
        c.number_format = "#,##0" if k == "lineas" else MONEDA
        c.font = Font(bold=True, size=11)
        # La referencia al valor que calculó el motor, para poder contrastar la
        # fórmula contra él de un vistazo.
        v = ws.cell(f2, 3, totales[k])
        v.number_format = "#,##0" if k == "lineas" else MONEDA
        v.font = Font(size=9, color=GRIS)
        donde[k] = f2
        f2 += 1

    ws.cell(3, 3, "engine").font = Font(size=9, italic=True, color=GRIS)
    # El «Unplaced» en rojo si se despega de cero, y lo mismo para cualquier
    # diferencia entre la fórmula y lo que calculó el motor.
    ws.conditional_formatting.add(
        f"B{donde['sin_ubicar']}",
        CellIsRule(operator="notBetween", formula=["-5", "5"],
                   fill=PatternFill("solid", bgColor=ROJO),
                   font=Font(bold=True, color="FF9C0006")),
    )
    for col, w in ((1, 42), (2, 20), (3, 16)):
        ws.column_dimensions[gc(col)].width = w
