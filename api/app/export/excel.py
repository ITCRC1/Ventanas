"""Exportador del modelo Excel VIVO desde Postgres (Fase 8).

Porta la lógica de presentación del prototipo etl/export_excel.py — el docstring
del prototipo ya avisaba: "en producción cambia la consulta, no la lógica". Aquí
la fuente es la base de la app (Postgres) vía SQLAlchemy, no el SQLite del ETL.

Genera un .xlsx que:
  - se ve como el master (mismos colores/estados),
  - lleva FÓRMULAS reales (Spend, Remaining, subtotales, totales) — editás el
    LEDGER y todo recalcula,
  - agrupa de verdad en 3 niveles: semana -> mes -> trimestre.
"""

from __future__ import annotations

import contextlib
import datetime as dt
from collections import defaultdict
from collections.abc import Iterable
from io import BytesIO
from typing import Any

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter as gc
from openpyxl.worksheet.properties import Outline
from openpyxl.worksheet.table import Table, TableStyleInfo
from sqlalchemy import text
from sqlalchemy.engine.row import RowMapping
from sqlalchemy.orm import Session

from app.core.holding import HOLDING_BANK

STATES = [
    ("not_started", "Not Started", "CCCCCC"),
    ("in_process", "In process", "FFFF00"),
    ("approved", "Approved", "1155CC"),
    ("attention", "Attention", "B85B22"),
    ("completed", "Completed", "38761D"),
]
STATE_FILL = {c: PatternFill("solid", fgColor="FF" + h) for c, _, h in STATES}

HDR = PatternFill("solid", fgColor="FF434343")
SUBHDR = PatternFill("solid", fgColor="FFD9D9D9")
TOTAL = PatternFill("solid", fgColor="FFC8DCF0")
CATF = PatternFill("solid", fgColor="FFF8F8F8")
WHITE = Font(color="FFFFFFFF", bold=True)
BOLD = Font(bold=True)
MONEY = "#,##0.00;[Red](#,##0.00)"
DEFAULT_CAT_HEX = "94A3B8"  # gris para categorías sin color


def _soften(hex6: str) -> str:
    """Aclara un color 50% hacia blanco (igual que la app cuando la celda tiene
    cifra, para que se lea el número). hex6 = 'RRGGBB'."""
    h = hex6.lstrip("#")
    if len(h) != 6:
        return hex6
    r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    r, g, b = (round(c + (255 - c) * 0.5) for c in (r, g, b))
    return f"{r:02X}{g:02X}{b:02X}"


def _mondays(start: dt.date, end: dt.date) -> list[dt.date]:
    d = start - dt.timedelta(days=start.weekday())
    out: list[dt.date] = []
    while d <= end:
        out.append(d)
        d += dt.timedelta(days=7)
    return out


def _suma(refs: Iterable[str]) -> str:
    """`=SUM(a,b,c)` en vez de `=a+b+c`.

    Las dos dan el mismo numero mientras todo sea numero. La cadena de `+`
    revienta con `#VALUE!` si una sola de las celdas trae texto —un rotulo
    pegado de mas, una celda que alguien escribio a mano— y se lleva por
    delante el total; `SUM` se salta lo que no es numero. Ademas es mas corta,
    que importa cuando la lista pasa del centenar de filas.

    Excel admite 255 argumentos por `SUM`; con mas, se parte en varias.
    """
    partes = list(refs)
    if not partes:
        return "=0"
    trozos = [partes[i:i + 200] for i in range(0, len(partes), 200)]
    return "=" + "+".join("SUM(" + ",".join(t) + ")" for t in trozos)


def _fecha(v: object) -> object:
    """Texto ISO -> date, para que Excel la trate como fecha.

    El LEDGER guarda las fechas como texto. Lo que no sea `YYYY-MM-DD` se
    devuelve sin tocar: es preferible una celda con texto raro a una vacía que
    esconda que ahí había algo.
    """
    if isinstance(v, dt.date) or v is None:
        return v
    try:
        return dt.date.fromisoformat(str(v).strip()[:10])
    except ValueError:
        return v


def _quarter(d: dt.date) -> str:
    return f"Q{(d.month - 1) // 3 + 1} {d.year}"


def _week_bounds(db: Session, start: dt.date | None, end: dt.date | None) -> tuple[dt.date, dt.date]:
    if start and end:
        return start, end
    row = db.execute(text("SELECT min(week_start), max(week_start) FROM schedule_cell")).first()
    lo = start or (row[0] if row and row[0] else dt.date(2026, 1, 5))
    hi = end or (row[1] if row and row[1] else dt.date(2026, 12, 28))
    return lo, hi


class ExcelExporter:
    """Construye el workbook leyendo de Postgres. Devuelve bytes (.xlsx)."""

    def __init__(self, db: Session, start: dt.date, end: dt.date) -> None:
        self.db = db
        self.weeks = _mondays(start, end)
        self.wb = Workbook()
        # Color por categoría (como el pincel del app: el color se comparte entre
        # Job Cost, Timeline y Timeline Detail porque salen del mismo schedule_cell).
        self.cat_hex: dict[str, str] = {
            (r["name"] or "").strip(): (r["color_hex"] or "").lstrip("#") or DEFAULT_CAT_HEX
            for r in db.execute(text("SELECT name, color_hex FROM category")).mappings()
        }

    def _cat_fill(self, category: str | None, has_amount: bool) -> PatternFill:
        """Relleno de una celda de semana PINTADA: color de la categoría (atenuado
        50% si tiene cifra, para leer el número) — idéntico en las 3 vistas."""
        hexc = self.cat_hex.get((category or "").strip(), DEFAULT_CAT_HEX)
        if has_amount:
            hexc = _soften(hexc)
        return PatternFill("solid", fgColor="FF" + hexc)


    def build(self) -> bytes:
        self._sheet_ledger()
        self._sheet_dashboard()
        self._sheet_jobcost()
        self._sheet_timeline()
        self._sheet_timeline_detail()
        self._sheet_short_payment()
        self._sheet_creditos()
        self._sheet_bancos()
        self._sheet_wires()
        self._sheet_facturas()
        self._sheet_recibos()
        self._sheet_legend()
        # Mismo orden que las pestañas del app.
        order = ["Timeline", "Timeline Detail", "Job Cost Report", "Dashboard",
                 "Short Payment", "LEDGER", "Credits", "Banks",
                 "US Wire Transfers", "Invoices", "Invoice Receipts", "Legend"]
        # ⚠️ Una hoja que no figure aca cae al final en silencio: `order.index`
        # falla y el `key` devuelve 99. Asi fue como "Invoice Receipts" -las 156
        # facturas de verdad- quedaba DESPUES del Legend, que es el cierre del
        # libro. Al agregar una hoja hay que agregarla tambien a esta lista.
        with contextlib.suppress(Exception):
            self.wb._sheets.sort(
                key=lambda sh: order.index(sh.title) if sh.title in order else 99
            )
        bio = BytesIO()
        self.wb.save(bio)
        return bio.getvalue()

    def _sheet_ledger(self) -> None:
        """El LEDGER, igual que lo muestra la app.

        ⚠️ Lee `ledger_sheet_row`, NO `ledger_entry`.

        Hasta el 2026-11-08 esta hoja exportaba `ledger_entry`, una tabla vieja
        que quedó al lado y que ya nadie alimenta: 261 filas por $1,439,283.17
        pagados, cuando el proyecto lleva $14,313,437.35. El dueño veía una
        DÉCIMA PARTE del gasto.

        Y no se quedaba acá: el Job Cost y el Dashboard no calculan el gasto,
        lo traen de esta hoja con `SUMIF(LEDGER!$A:$A, wbs, LEDGER!$G:$G)`. Un
        solo origen equivocado ensuciaba tres hojas sin que nada avisara,
        porque el libro seguía cuadrando consigo mismo.

        De ahí dos reglas que hay que respetar al tocar esto:
          · el Cost Code va en la columna A y el Amount Paid en la G;
          · `v_wbs_financials.spend` suma `amount_paid` de las filas
            `kind='data'`, así que la hoja tiene que traer esas mismas filas.
        """
        ws = self.wb.active
        ws.title = "LEDGER"
        cols = [
            "Cost Code", "Date", "Invoice #", "Payee", "Description",
            "Amount", "Amount Paid", "Amount Due", "Account",
            "Beneficiary", "Paid Total", "Date Paid",
        ]
        ws.append([])
        ws.append([])
        ws.append(cols)
        for c in range(1, len(cols) + 1):
            ws.cell(3, c).fill = HDR
            ws.cell(3, c).font = WHITE
        rows = self.db.execute(
            text(
                """
                SELECT kind, section, cost_code, account, entry_date, invoice_no,
                       payee, beneficiary, description, amount, amount_paid,
                       paid_total, date_paid
                FROM ledger_sheet_row
                ORDER BY row_no
                """
            )
        ).mappings()
        r = 4
        for e in rows:
            if e["kind"] != "data":
                # Encabezados del LEDGER: los tres de arriba (Project, Address…)
                # y los separadores de sección. Se escriben como rótulo para que
                # el libro se lea igual que la pantalla. Van SIN cost code, así
                # que los SUMIF del Job Cost no los ven.
                etq = (e["cost_code"] or e["section"] or "").strip()
                val = (e["account"] or "").strip()
                if etq or val:
                    ws.cell(r, 2, etq).font = Font(bold=True)
                    if val:
                        ws.cell(r, 3, val)
                    r += 1
                continue
            ws.cell(r, 1, (e["cost_code"] or "").strip())
            # ⚠️ En `ledger_sheet_row` la fecha es TEXTO, no `date`. Se convierte
            # cuando se puede para que Excel la ordene y la filtre como fecha; lo
            # que no sea una fecha ISO se escribe tal cual en vez de perderse.
            ws.cell(r, 2, _fecha(e["entry_date"]))
            ws.cell(r, 3, e["invoice_no"])
            ws.cell(r, 4, e["payee"])
            ws.cell(r, 5, e["description"])
            ws.cell(r, 6, float(e["amount"] or 0)).number_format = MONEY
            ws.cell(r, 7, float(e["amount_paid"] or 0)).number_format = MONEY
            ws.cell(r, 8, f"=F{r}-G{r}").number_format = MONEY  # Amount Due VIVO
            ws.cell(r, 9, e["account"])
            ws.cell(r, 10, e["beneficiary"])
            # `paid_total` y `date_paid` son TEXTO libre en el LEDGER —se ven
            # cosas como "PAGO6374.70 OCTUBRE". Se copian tal cual: convertirlos
            # a número perdería lo que el usuario escribió.
            ws.cell(r, 11, e["paid_total"])
            ws.cell(r, 12, e["date_paid"])
            r += 1
        self.ledger_last = max(r - 1, 4)
        # GRAN TOTAL arriba, como en la pantalla. Va FUERA de la tabla: adentro
        # se sumaría a sí mismo en cuanto alguien agregue una fila.
        ws.cell(2, 5, "GRAND TOTAL").font = Font(bold=True)
        for col in (6, 7):
            cel = ws.cell(2, col, f"=SUM({gc(col)}4:{gc(col)}{self.ledger_last})")
            cel.number_format = MONEY
            cel.font = Font(bold=True)
            cel.fill = TOTAL
        for c, w in zip(
            range(1, 13),
            [12, 12, 14, 26, 46, 14, 14, 14, 30, 24, 14, 12],
            strict=False,
        ):
            ws.column_dimensions[gc(c)].width = w
        ws.freeze_panes = "B4"
        # ⚠️ L15 del audit: tabla de Excel de verdad, no un autofiltro suelto.
        # Una fila escrita debajo entra sola al rango —y por lo tanto a los
        # SUMIF del Job Cost— en vez de quedarse fuera sin que nadie lo note.
        # El autofiltro no se pone: Excel no admite los dos sobre el mismo
        # rango, y la tabla ya trae el suyo.
        t = Table(displayName="Ledger", ref=f"A3:L{self.ledger_last}")
        t.tableStyleInfo = TableStyleInfo(
            name="TableStyleLight1", showRowStripes=True, showColumnStripes=False
        )
        ws.add_table(t)

    # ------------------------------------------------------------------ 2

    def _sheet_jobcost(self) -> None:
        """Job Cost Report FORMULADO — réplica de la vista del app (JobCostFull).

        Reemplaza el _sheet_jobcost anterior. Cambios clave vs. la base:
          - agrupa por CATEGORÍA (como el app: fila de categoría + subtotales);
          - por cada categoría, una fila TOTAL GASTOS (líneas kind<>'proceeds')
            y, SOLO si hay proceeds, una fila TOTAL VENTA (las líneas de venta
            NO se listan como filas: sólo suman en ese subtotal);
          - todo lo calculado es FÓRMULA VIVA (Revised=G+H, Spend=SUMIF al
            LEDGER, Remaining=I-J, Forecast=Spend+Timeline, Variance=I-L,
            subtotales con SUM de rango, TOTAL VENTA con SUMIF por código,
            PROJECT TOTAL = suma de las filas de subtotal — sin doble conteo);
          - mantiene semana->mes->trimestre con outline y el color del estado
            (schedule_cell.state_id) en cada celda de semana.
        Layout ANCLA intacto (cabecera fila 5): A=Status B=WBS C=Task Title
        D=Owner E=Category F=Phase G=Orig H=Change I=Revised J=Spend
        K=Remaining L=Forecast M=Variance, luego semana/mes/trim y TOTAL final.
        """
        ws = self.wb.create_sheet("Job Cost Report")
        ws.sheet_properties.outlinePr = Outline(
            summaryRight=True, summaryBelow=False, showOutlineSymbols=True
        )
        ws["A1"] = "DASHBOARD VENTANAS — Job Cost Report"
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = "Live model. Edit the LEDGER and everything recalculates."
        ws["A2"].font = Font(italic=True, color="FF808080")

        GREEN = PatternFill("solid", fgColor="FFDFF3E3")  # fondo TOTAL VENTA
        WEEKFMT = "#,##0"

        fixed = [
            "Status", "WBS", "Task Title", "Owner", "Category", "Phase",
            "Budget Original", "Budget Change", "Budget Revised",
            "Spend", "Remaining", "Forecast", "Variance",
        ]
        hr = 5
        for i, h in enumerate(fixed, 1):
            c = ws.cell(hr, i, h)
            c.fill = HDR
            c.font = WHITE
            c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        ws.row_dimensions[hr].height = 30

        # --- cabecera de tiempo: semana -> mes -> trimestre (con outline) ---
        col = len(fixed) + 1
        self.week_col: dict[dt.date, int] = {}
        self.month_col: dict[tuple[int, int], tuple[int, int, int]] = {}
        self.qtr_col: dict[str, tuple[int, list[int]]] = {}
        by_q: dict[str, dict[tuple[int, int], list[dt.date]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for w in self.weeks:
            by_q[_quarter(w)][(w.year, w.month)].append(w)

        for qname, months in by_q.items():
            m_cols: list[int] = []
            for (yy, mm), wks in months.items():
                w_first = col
                for w in wks:
                    # J5 del audit: la FECHA REAL del lunes, en la fila 2. La
                    # fila 5 sólo trae el día ("1", "8", "15"), que no sirve
                    # para sumar por fecha. Las columnas de MES y TRIMESTRE se
                    # quedan vacías acá a propósito: así un SUMIF sobre la fila
                    # 2 toca sólo semanas y nunca cuenta un subtotal.
                    wd = ws.cell(2, col, w)
                    wd.number_format = "yyyy-mm-dd"
                    wd.font = Font(size=7, color="FF808080")
                    wd.alignment = Alignment(horizontal="center")
                    ws.cell(3, col, qname)
                    ws.cell(4, col, dt.date(yy, mm, 1).strftime("%b %Y").upper())
                    cc = ws.cell(hr, col, w.day)
                    cc.fill = SUBHDR
                    cc.font = Font(bold=True, size=9)
                    cc.alignment = Alignment(horizontal="center")
                    ws.column_dimensions[gc(col)].width = 5.5
                    self.week_col[w] = col
                    col += 1
                mc = ws.cell(hr, col, dt.date(yy, mm, 1).strftime("%b").upper())
                mc.fill = PatternFill("solid", fgColor="FFA2C4C9")
                mc.font = BOLD
                mc.alignment = Alignment(horizontal="center")
                ws.cell(3, col, qname)
                ws.cell(4, col, "MONTH")
                ws.column_dimensions[gc(col)].width = 12
                self.month_col[(yy, mm)] = (col, w_first, col - 1)
                m_cols.append(col)
                for k in range(w_first, col):
                    ws.column_dimensions[gc(k)].outlineLevel = 2
                col += 1
            qc = ws.cell(hr, col, qname)
            qc.fill = TOTAL
            qc.font = BOLD
            qc.alignment = Alignment(horizontal="center")
            ws.cell(3, col, qname)
            ws.cell(4, col, "QUARTER")
            ws.column_dimensions[gc(col)].width = 14
            self.qtr_col[qname] = (col, m_cols)
            for k in m_cols:
                ws.column_dimensions[gc(k)].outlineLevel = 1
            col += 1
        self.total_col = col
        tc = ws.cell(hr, col, "TOTAL")
        tc.fill = HDR
        tc.font = WHITE
        ws.column_dimensions[gc(col)].width = 15

        # ── C1 y J6 del audit: dos columnas al FINAL ────────────────────────
        #
        # Van al final y no entre las fijas a proposito: el layout A..M es un
        # ancla —hay formulas y notas que lo citan por letra— y correrlo
        # romperia mas de lo que arregla.
        #
        # ⚠️ C1: el Forecast decia `=J+TOTAL`, o sea gastado + TODO el plan.
        # Pero el plan ANTERIOR al corte es historia: reproduce lo que el
        # LEDGER ya pago. Sumarlo al gastado lo cuenta dos veces — en la
        # 0.0002 daba 24,375,000 donde el presupuesto son 15,000,000.
        #
        # Comprobado contra la base en las 14 lineas mas grandes: la app define
        # Forecast = gastado + lo pintado DESPUES del corte. Esta columna aisla
        # ese "despues" con un SUMIF sobre la fila 2 de fechas, que es la unica
        # manera de hacerlo con formula viva y no con un numero pegado.
        self.future_col = col + 1
        fcell = ws.cell(hr, self.future_col, "PLAN POST-CORTE")
        fcell.fill = HDR
        fcell.font = WHITE
        fcell.alignment = Alignment(horizontal="center", wrap_text=True)
        ws.cell(4, self.future_col, "FORECAST")
        ws.column_dimensions[gc(self.future_col)].width = 15

        # J6: el plan fasado no siempre suma al presupuesto revisado —hay 17
        # lineas que difieren por centavos—. La columna lo deja a la vista en
        # vez de que haya que buscarlo.
        self.check_col = col + 2
        kcell = ws.cell(hr, self.check_col, "PLAN vs PRESUP.")
        kcell.fill = HDR
        kcell.font = WHITE
        kcell.alignment = Alignment(horizontal="center", wrap_text=True)
        ws.cell(4, self.check_col, "CONTROL")
        ws.column_dimensions[gc(self.check_col)].width = 15

        # El corte que separa historia de futuro. Es el mismo de `settings` que
        # usa la app: con otro, el Excel y la pantalla dirian forecasts
        # distintos sobre las mismas celdas.
        self.cutoff = self.db.execute(
            text("SELECT cutoff_date FROM settings LIMIT 1")
        ).scalar()
        _a = gc(min(self.week_col.values()))
        _b = gc(self.total_col - 1)
        _c = self.cutoff
        self._futuro_f = (
            f'=SUMIF(${_a}$2:${_b}$2,">="&DATE({_c.year},{_c.month},{_c.day}),'
            f"{_a}{{r}}:{_b}{{r}})"
            if _c
            else "=0"
        )

        # Columnas de dinero de una fila (para subtotales/total): las 7 fijas
        # G..M + TODAS las de tiempo (semana/mes/trim) + la TOTAL final.
        money_cols = list(range(7, 14)) + list(range(14, self.check_col + 1))
        wcols = set(self.week_col.values())

        def numfmt(c: int) -> str:
            return WEEKFMT if c in wcols else MONEY

        # --- filas: v_wbs_financials, agrupadas por CATEGORÍA ---
        rows = self.db.execute(
            text(
                """
                SELECT f.wbs_code, f.title, f.owner, f.category, f.phase, f.kind,
                       ts.label AS status_label,
                       f.budget_original, f.budget_change,
                       w.forecast_total AS forecast_ovr
                FROM v_wbs_financials f
                LEFT JOIN wbs_item  w  ON w.wbs_code = f.wbs_code
                LEFT JOIN task_state ts ON ts.id = w.state_id
                WHERE f.kind <> 'section_header'
                ORDER BY COALESCE(f.category, 'zzz'), w.sort_order, f.wbs_code
                """
            )
        ).mappings().all()

        # Cronograma (schedule_cell): monto plan + estado por cost_code y semana.
        sched: defaultdict[str, dict[dt.date, RowMapping]] = defaultdict(dict)
        for s in self.db.execute(
            text(
                """
                SELECT w.wbs_code, s.week_start, s.planned_amount, ts.code AS state_code
                FROM schedule_cell s
                JOIN wbs_item w    ON w.id = s.wbs_id
                JOIN task_state ts ON ts.id = s.state_id
                """
            )
        ).mappings():
            sched[(s["wbs_code"] or "").strip()][s["week_start"]] = s

        # Agrupar líneas por categoría (orden que fija el ORDER BY de la query).
        cats: dict[str, list[RowMapping]] = defaultdict(list)
        for e in rows:
            cats[(e["category"] or "No category").strip()].append(e)

        def write_timeline_line(rr: int, code: str, category: str | None = None) -> None:
            """Celdas semana (valor base + COLOR DE LA CATEGORÍA, igual que el app —
            se sincroniza con Timeline/Detail) y mes/trim/total (fórmula)."""
            for w, wc in self.week_col.items():
                sc: RowMapping | None = sched[code].get(w)
                if not sc:
                    continue
                cell = ws.cell(rr, wc)
                amt = sc["planned_amount"]
                if amt:
                    cell.value = round(float(amt), 2)
                    cell.number_format = WEEKFMT
                cell.fill = self._cat_fill(category, bool(amt))
            for (_yy, _mm), (mc2, a, b) in self.month_col.items():
                ws.cell(rr, mc2, f"=SUM({gc(a)}{rr}:{gc(b)}{rr})").number_format = MONEY
            for _qn, (qc2, mcs) in self.qtr_col.items():
                ws.cell(rr, qc2, _suma(f"{gc(m)}{rr}" for m in mcs)).number_format = MONEY
            ws.cell(
                rr, self.total_col,
                _suma(f"{gc(q)}{rr}" for q, _ in self.qtr_col.values()),
            ).number_format = MONEY

        def write_timeline_venta(rr: int, codes: list[str]) -> None:
            """Igual, pero el valor semanal = suma de las líneas de venta (sin color)."""
            for w, wc in self.week_col.items():
                tot = 0.0
                for c in codes:
                    sc = sched[c].get(w)
                    if sc and sc["planned_amount"]:
                        tot += float(sc["planned_amount"])
                if tot:
                    ws.cell(rr, wc, round(tot, 2)).number_format = WEEKFMT
            for (_yy, _mm), (mc2, a, b) in self.month_col.items():
                ws.cell(rr, mc2, f"=SUM({gc(a)}{rr}:{gc(b)}{rr})").number_format = MONEY
            for _qn, (qc2, mcs) in self.qtr_col.items():
                ws.cell(rr, qc2, _suma(f"{gc(m)}{rr}" for m in mcs)).number_format = MONEY
            ws.cell(
                rr, self.total_col,
                _suma(f"{gc(q)}{rr}" for q, _ in self.qtr_col.values()),
            ).number_format = MONEY

        r = hr + 1
        # J3 del audit: dos listas, no una. El PROJECT TOTAL sumaba gastos y
        # ventas en la misma celda, y la venta de Ventanas entra con signo
        # negativo (-480,000): el presupuesto del proyecto salia 480,000 por
        # debajo de lo que es, sin que nada avisara.
        cost_totals: list[int] = []   # filas TOTAL EXPENSES
        sale_totals: list[int] = []   # filas TOTAL SALES

        for cat, lines in cats.items():
            costs = [e for e in lines if (e["kind"] or "cost") != "proceeds"]
            sales = [e for e in lines if (e["kind"] or "cost") == "proceeds"]

            # Encabezado de categoría (fila coloreada; título en col Task Title).
            for i in range(1, self.total_col + 1):
                ws.cell(r, i).fill = CATF
            ws.cell(r, 3, cat.upper()).font = BOLD
            r += 1

            # --- Líneas de GASTO (las de venta NO se listan) ---
            first_cost = r
            for e in costs:
                code = (e["wbs_code"] or "").strip()
                ws.cell(r, 1, e["status_label"])
                ws.cell(r, 2, code)
                ws.cell(r, 3, e["title"])
                ws.cell(r, 4, e["owner"])
                ws.cell(r, 5, cat)
                ws.cell(r, 6, e["phase"])
                ws.cell(r, 7, float(e["budget_original"] or 0)).number_format = MONEY  # base
                ws.cell(r, 8, float(e["budget_change"] or 0)).number_format = MONEY    # base
                # FÓRMULAS VIVAS
                ws.cell(r, 9, f"=G{r}+H{r}").number_format = MONEY                      # Revised
                ws.cell(
                    r, 10, f"=SUMIF(LEDGER!$A:$A,$B{r},LEDGER!$G:$G)"
                ).number_format = MONEY                                                # Spend
                ws.cell(r, 11, f"=I{r}-J{r}").number_format = MONEY                     # Remaining
                if e["forecast_ovr"] is not None:  # override manual del app = dato base
                    ws.cell(r, 12, float(e["forecast_ovr"])).number_format = MONEY
                else:  # Forecast = Spend + Timeline Total (vivo)
                    # C1: gastado + plan POSTERIOR al corte, no el total.
                    ws.cell(r, 12, f"=J{r}+{gc(self.future_col)}{r}").number_format = MONEY
                    ws.cell(r, self.future_col, self._futuro_f.format(r=r)).number_format = MONEY
                    ws.cell(r, self.check_col, f"=ROUND({gc(self.total_col)}{r}-I{r},2)").number_format = MONEY
                ws.cell(r, 13, f"=I{r}-L{r}").number_format = MONEY                     # Variance
                write_timeline_line(r, code, cat)
                r += 1
            last_cost = r - 1

            # --- TOTAL GASTOS (SUM del rango contiguo de líneas de gasto) ---
            for i in range(1, self.total_col + 1):
                ws.cell(r, i).fill = TOTAL
            ws.cell(r, 3, "TOTAL EXPENSES").font = BOLD
            for c in money_cols:
                if costs:
                    ws.cell(r, c, f"=SUM({gc(c)}{first_cost}:{gc(c)}{last_cost})")
                else:
                    ws.cell(r, c, 0)
                ws.cell(r, c).number_format = numfmt(c)
                ws.cell(r, c).font = BOLD
            cost_totals.append(r)
            r += 1

            # --- TOTAL VENTA (sólo si la categoría tiene proceeds) ---
            if sales:
                sale_codes = [(e["wbs_code"] or "").strip() for e in sales]
                for i in range(1, self.total_col + 1):
                    ws.cell(r, i).fill = GREEN
                ws.cell(r, 2, ", ".join(sale_codes))
                ws.cell(r, 3, "TOTAL SALES").font = BOLD
                # G/H = datos base (constantes); el resto, fórmula viva.
                ws.cell(
                    r, 7, sum(float(e["budget_original"] or 0) for e in sales)
                ).number_format = MONEY
                ws.cell(
                    r, 8, sum(float(e["budget_change"] or 0) for e in sales)
                ).number_format = MONEY
                ws.cell(r, 9, f"=G{r}+H{r}").number_format = MONEY
                # J2 del audit: con un solo codigo de venta, el gasto se busca
                # por la celda B de esta misma fila y no por el texto "6"
                # escrito dentro de la formula. Asi, cambiar el codigo en B
                # mueve tambien el numero; antes la formula seguia buscando el
                # codigo viejo y nadie se enteraba.
                if len(sale_codes) == 1:
                    ws.cell(
                        r, 10, f"=SUMIF(LEDGER!$A:$A,$B{r},LEDGER!$G:$G)"
                    ).number_format = MONEY
                else:
                    # Con varios, B lleva "a, b" y SUMIF no lo entiende: hay
                    # que nombrarlos uno a uno.
                    ws.cell(r, 10, _suma(
                        f'SUMIF(LEDGER!$A:$A,"{c}",LEDGER!$G:$G)' for c in sale_codes
                    )).number_format = MONEY
                ws.cell(r, 11, f"=I{r}-J{r}").number_format = MONEY
                write_timeline_venta(r, sale_codes)
                # C1: gastado + plan POSTERIOR al corte, no el total.
                ws.cell(r, 12, f"=J{r}+{gc(self.future_col)}{r}").number_format = MONEY
                ws.cell(r, self.future_col, self._futuro_f.format(r=r)).number_format = MONEY
                ws.cell(r, self.check_col, f"=ROUND({gc(self.total_col)}{r}-I{r},2)").number_format = MONEY
                ws.cell(r, 13, f"=I{r}-L{r}").number_format = MONEY
                for c in money_cols:
                    ws.cell(r, c).font = BOLD
                sale_totals.append(r)
                r += 1

        # --- Totales del proyecto: gasto y venta en filas SEPARADAS ---
        def _total_row(rr: int, label: str, srcs: list[int], fill: PatternFill) -> None:
            for i in range(1, self.total_col + 1):
                ws.cell(rr, i).fill = fill
            ws.cell(rr, 3, label).font = BOLD
            for c in money_cols:
                ws.cell(
                    rr, c, _suma(f"{gc(c)}{x}" for x in srcs)
                ).number_format = numfmt(c)
                ws.cell(rr, c).font = BOLD

        _total_row(r, "PROJECT TOTAL — EXPENSES", cost_totals, TOTAL)
        r += 1
        if sale_totals:
            _total_row(r, "PROJECT TOTAL — SALES", sale_totals, GREEN)
            r += 1
            _total_row(r, "NET (EXPENSES + SALES)", cost_totals + sale_totals, TOTAL)

        for c, width in zip(
            range(1, 14), [11, 10, 42, 14, 20, 20, 15, 14, 15, 15, 15, 15, 14], strict=False
        ):
            ws.column_dimensions[gc(c)].width = width
        ws.freeze_panes = ws.cell(hr + 1, 7)
        ws.conditional_formatting.add(
            f"K{hr + 1}:K{r}",
            CellIsRule(
                operator="lessThan",
                formula=["0"],
                fill=PatternFill("solid", fgColor="FFF4CCCC"),
                font=Font(color="FF9C0006"),
            ),
        )

    def _sheet_timeline(self) -> None:
        """Hoja "Timeline": réplica FORMULADA de la vista del app (Timeline.tsx).

        Roll-up por categoría -> fase con columnas de la izquierda
        Budget Revised / YTD Expense / Remaining / Forecast / Funding Pending
        (fórmulas VIVAS al Job Cost Report) y, a la derecha, la matriz
        semana -> mes -> trimestre + FULL YEAR. Los montos de semana salen de
        schedule_cell (dato base = VALOR); mes/trimestre/año y subtotales son
        SUM/agregaciones vivas. El split GASTO/VENTA es por `kind`
        (kind='proceeds' = venta): la venta NO se lista como fila de fase, va
        sólo como subtotal TOTAL VENTA (idéntico al front).
        """
        JC = "'Job Cost Report'"
        MESES_UP = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG",
                    "SEP", "OCT", "NOV", "DEC"]
        VENTA_FILL = PatternFill("solid", fgColor="FFDFF3E3")
        GREY = Font(color="FF999999")

        def _clean(name: str) -> str:
            # Igual que cleanCatName del front: quita prefijo "N-" ("0-Property
            # Acquisition" -> "Property Acquisition"); NO toca "6.1 Overhead".
            i = name.find("-")
            if i > 0 and name[:i].strip().isdigit():
                return name[i + 1:].strip()
            return name

        ws = self.wb.create_sheet("Timeline")
        ws.sheet_properties.outlinePr = Outline(
            summaryRight=True, summaryBelow=False, showOutlineSymbols=True
        )
        ws["A1"] = "DASHBOARD VENTANAS — Timeline (roll-up by category → phase)"
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = (
            "Live model. Budgets = formulas to the Job Cost Report; "
            "weeks = plan (schedule_cell). Edit the LEDGER/Job Cost and it recalculates."
        )
        ws["A2"].font = Font(italic=True, color="FF808080")

        # --- cabecera izquierda (7 columnas fijas, como LEFT_COLS del front) ---
        left = [
            "Project Category", "Phases", "Budget Revised", "YTD Expense",
            "Remaining", "Forecast", "Funding Pending",
        ]
        FIXED = len(left)  # 7
        hr = 5
        for i, h in enumerate(left, 1):
            c = ws.cell(hr, i, h)
            c.fill = HDR
            c.font = WHITE
            c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        ws.row_dimensions[hr].height = 30

        # --- matriz semana -> mes -> trimestre (mismo layout que Job Cost) ---
        col = FIXED + 1
        week_col: dict[dt.date, int] = {}
        month_col: dict[tuple[int, int], tuple[int, int, int]] = {}
        qtr_col: dict[str, tuple[int, list[int]]] = {}
        by_q: dict[str, dict[tuple[int, int], list[dt.date]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for w in self.weeks:
            by_q[_quarter(w)][(w.year, w.month)].append(w)

        for qname, months in by_q.items():
            m_cols: list[int] = []
            for (yy, mm), wks in months.items():
                w_first = col
                for w in wks:
                    ws.cell(3, col, qname)
                    ws.cell(4, col, f"{MESES_UP[mm - 1]} {yy}")
                    cc = ws.cell(hr, col, w.day)
                    cc.fill = SUBHDR
                    cc.font = Font(bold=True, size=9)
                    cc.alignment = Alignment(horizontal="center")
                    ws.column_dimensions[gc(col)].width = 5.5
                    ws.column_dimensions[gc(col)].outlineLevel = 2
                    week_col[w] = col
                    col += 1
                mc = ws.cell(hr, col, MESES_UP[mm - 1])
                mc.fill = PatternFill("solid", fgColor="FFA2C4C9")
                mc.font = BOLD
                mc.alignment = Alignment(horizontal="center")
                ws.cell(3, col, qname)
                ws.cell(4, col, "MONTH")
                ws.column_dimensions[gc(col)].width = 12
                ws.column_dimensions[gc(col)].outlineLevel = 1
                month_col[(yy, mm)] = (col, w_first, col - 1)
                m_cols.append(col)
                col += 1
            qc = ws.cell(hr, col, qname)
            qc.fill = TOTAL
            qc.font = BOLD
            qc.alignment = Alignment(horizontal="center")
            ws.cell(3, col, qname)
            ws.cell(4, col, "QUARTER")
            ws.column_dimensions[gc(col)].width = 14
            qtr_col[qname] = (col, m_cols)
            col += 1
        total_col = col
        tc = ws.cell(hr, col, "FULL YEAR")
        tc.fill = PatternFill("solid", fgColor="FF1A7F4B")
        tc.font = WHITE
        tc.alignment = Alignment(horizontal="center")
        ws.column_dimensions[gc(col)].width = 15

        week_cols_all = list(week_col.values())
        month_cols_all = [c for c, _, _ in month_col.values()]
        qtr_cols_all = [c for c, _ in qtr_col.values()]
        week_set = set(week_cols_all)
        agg_grid = week_cols_all + month_cols_all + qtr_cols_all + [total_col]

        # --- datos: líneas (v_wbs_financials, orden wbs_code igual que la API) ---
        lines = self.db.execute(
            text(
                """
                SELECT f.id, f.wbs_code, f.category, f.phase, f.kind
                FROM v_wbs_financials f
                WHERE f.kind <> 'section_header'
                ORDER BY f.wbs_code
                """
            )
        ).mappings().all()
        sched: dict[tuple[int, dt.date], float] = {}
        for s in self.db.execute(
            text("SELECT wbs_id, week_start, planned_amount FROM schedule_cell")
        ).mappings():
            # Guardamos TODAS las celdas (presencia = pintada), monto 0 si es sólo color.
            sched[(s["wbs_id"], s["week_start"])] = float(s["planned_amount"] or 0)
        # orden de categorías = category.sort_order (como tool.catOrder del front),
        # incluyendo las vacías (aparecen con su TOTAL en 0, igual que el app).
        cat_order = self.db.execute(
            text("SELECT name FROM category WHERE is_active ORDER BY sort_order, name")
        ).scalars().all()

        # agrupar categoría -> fase (costos) + ventas (proceeds), preservando el
        # orden de wbs_code para las fases (idéntico al Map del front).
        groups: dict[str, dict[str, Any]] = {}
        for e in lines:
            cat = e["category"] or "No category"
            g = groups.setdefault(cat, {"phases": {}, "sales": []})
            code = (e["wbs_code"] or "").strip()
            if e["kind"] == "proceeds":
                g["sales"].append((e["id"], code))
            else:
                ph = e["phase"] or "No phase"
                g["phases"].setdefault(ph, []).append((e["id"], code))
        ordered = list(cat_order)
        for n in groups:
            if n not in ordered:
                ordered.append(n)

        # ---- helpers de fórmulas ----
        def _sumif(codes: list[tuple[int, str]], src: str) -> object:
            # Presupuesto/gasto/forecast de un conjunto de WBS: SUMIF al Job Cost.
            if not codes:
                return 0
            return _suma(
                f'SUMIF({JC}!$B:$B,"{c}",{JC}!${src}:${src})' for _i, c in codes
            )

        def _leaf(
            row: int,
            codes: list[tuple[int, str]],
            bold: bool = False,
            category: str | None = None,
            paint: bool = True,
        ) -> None:
            # Fila "hoja" (fase de costos o subtotal de venta): budgets vivos al
            # Job Cost + semanas por VALOR (schedule_cell), coloreadas por CATEGORÍA
            # (igual que Job Cost/Detail) + mes/qtr/año por SUM.
            ws.cell(row, 3, _sumif(codes, "I")).number_format = MONEY   # Budget Revised
            ws.cell(row, 4, _sumif(codes, "J")).number_format = MONEY   # YTD Expense (spend)
            ws.cell(row, 5, f"={gc(3)}{row}-{gc(4)}{row}").number_format = MONEY  # Remaining
            ws.cell(row, 6, _sumif(codes, "L")).number_format = MONEY   # Forecast
            ws.cell(row, 7, f"={gc(6)}{row}-{gc(4)}{row}").number_format = MONEY  # Funding Pending
            ids = [i for i, _ in codes]
            for w, wc in week_col.items():
                if not any((i, w) in sched for i in ids):
                    continue
                v = sum(sched.get((i, w), 0.0) for i in ids)
                cell = ws.cell(row, wc)
                if v:
                    # TL2 del audit: esto era el numero pegado. Ahora la semana
                    # sale por SUMIF al Job Cost igual que Budget, Spend y
                    # Forecast de esta misma fila (_sumif, arriba): una sola
                    # fuente para toda la fila en vez de una mezcla de formula y
                    # valor que se desincroniza en cuanto alguien repinta.
                    jcr = self.week_col.get(w)
                    cell.value = _sumif(codes, gc(jcr)) if jcr else round(v, 2)
                    cell.number_format = "#,##0"
                if paint:
                    cell.fill = self._cat_fill(category, bool(v))
            for (_yy, _mm), (mc2, a, b) in month_col.items():
                ws.cell(row, mc2, f"=SUM({gc(a)}{row}:{gc(b)}{row})").number_format = MONEY
            for _qn, (qc2, mcs) in qtr_col.items():
                ws.cell(row, qc2, _suma(f"{gc(m)}{row}" for m in mcs)).number_format = MONEY
            ws.cell(
                row, total_col,
                _suma(f"{gc(q)}{row}" for q, _ in qtr_col.values()),
            ).number_format = MONEY
            if bold:
                for cc2 in range(3, 8):
                    ws.cell(row, cc2).font = BOLD

        def _agg(row: int, srcs: list[int], label: str, fill: PatternFill) -> None:
            # Fila agregada (TOTAL GASTOS / TOTAL <cat> / PROJECT TOTAL): cada
            # columna = suma VIVA de las filas fuente (fases o subtotales).
            for i in range(1, total_col + 1):
                ws.cell(row, i).fill = fill
            ws.cell(row, 1, label).font = BOLD

            def _s(c: int) -> object:
                return _suma(f"{gc(c)}{rr}" for rr in srcs)

            ws.cell(row, 3, _s(3)).number_format = MONEY
            ws.cell(row, 4, _s(4)).number_format = MONEY
            ws.cell(row, 5, f"={gc(3)}{row}-{gc(4)}{row}").number_format = MONEY
            ws.cell(row, 6, _s(6)).number_format = MONEY
            ws.cell(row, 7, f"={gc(6)}{row}-{gc(4)}{row}").number_format = MONEY
            for c in agg_grid:
                cell = ws.cell(row, c, _s(c))
                cell.number_format = "#,##0" if c in week_set else MONEY
            for c in range(3, 8):
                ws.cell(row, c).font = BOLD
            for c in agg_grid:
                ws.cell(row, c).font = BOLD

        # ---- filas ----
        r = hr + 1
        subtotal_rows: list[int] = []
        for cat in ordered:
            g = groups[cat]
            # encabezado de categoría (banda)
            for i in range(1, total_col + 1):
                ws.cell(r, i).fill = CATF
            ws.cell(r, 1, _clean(cat).upper()).font = BOLD
            r += 1
            # filas de fase (sólo costos; la venta va aparte)
            phase_rows: list[int] = []
            sales: list[tuple[int, str]] = []
            if g:
                for ph, codes in g["phases"].items():
                    ws.cell(r, 1, _clean(cat)).font = GREY
                    ws.cell(r, 2, ph)
                    _leaf(r, codes, category=cat)
                    phase_rows.append(r)
                    r += 1
                sales = g["sales"]
            # subtotales por categoría (misma regla de kind que el front)
            if sales:
                _agg(r, phase_rows, "TOTAL EXPENSES", TOTAL)
                subtotal_rows.append(r)
                r += 1
                for i in range(1, total_col + 1):
                    ws.cell(r, i).fill = VENTA_FILL
                ws.cell(r, 1, "TOTAL SALES · " + ", ".join(c for _i, c in sales)).font = BOLD
                _leaf(r, sales, bold=True, paint=False)  # mantiene el verde de la fila
                subtotal_rows.append(r)
                r += 1
            else:
                _agg(r, phase_rows, f"TOTAL {_clean(cat).upper()}", TOTAL)
                subtotal_rows.append(r)
                r += 1

        # PROJECT TOTAL = suma de todos los subtotales (= todas las líneas,
        # costos + ventas, igual que `grand` del front).
        _agg(r, subtotal_rows, "PROJECT TOTAL", TOTAL)

        # ancho de columnas izquierdas + congelar identidad/presupuesto.
        for c, wd in zip(range(1, 8), [22, 26, 15, 14, 14, 14, 15], strict=False):
            ws.column_dimensions[gc(c)].width = wd
        ws.freeze_panes = ws.cell(hr + 1, FIXED + 1)

    def _sheet_timeline_detail(self) -> None:
        """Timeline Detail — réplica FORMULADA de la vista del app (TimelineDetail.tsx).

        Mismas columnas de identidad + presupuesto (Project Category / Phases /
        Phases Subphase / WBS Number / Task Title / Owner / Budget Revised / YTD
        Expense / Remaining / Forecast / Funding Pending), las semanas agrupadas
        semana→mes→trimestre y un TOTAL AÑO, con las categorías agrupadas
        (cabecera + subtotal), en el orden del Excel (category.sort_order).

        Donde el app CALCULA, hay FÓRMULA VIVA: Budget Revised / YTD / Remaining /
        Forecast se traen del 'Job Cost Report' por SUMIF sobre el WBS; Funding =
        Forecast − YTD; los montos por semana son el dato base (planned_amount) y
        meses/trimestres/totales/subtotales son SUM de esas celdas.

        Split de venta: la línea kind='proceeds' NO se lista; aparece SOLO como
        fila de subtotal 'TOTAL VENTA · <wbs>'. Las líneas de gasto sí se listan y
        suman en 'TOTAL GASTOS' (o 'TOTAL <cat>' si la categoría no tiene venta).
        El PROJECT TOTAL suma TODAS las líneas (gastos + venta), como el app.
        """
        ws = self.wb.create_sheet("Timeline Detail")
        ws.sheet_properties.outlinePr = Outline(
            summaryRight=True, summaryBelow=False, showOutlineSymbols=True
        )
        # Fills propios de esta vista (colores del app; los de módulo se reutilizan)
        CAT_FILL = PatternFill("solid", fgColor="FFEAF0FA")   # cabecera categoría
        GASTO_FILL = PatternFill("solid", fgColor="FFDCE6F4")  # TOTAL / TOTAL GASTOS
        VENTA_FILL = PatternFill("solid", fgColor="FFDFF3E3")  # TOTAL VENTA (verde)
        RED_FILL = PatternFill("solid", fgColor="FFF4CCCC")
        RED_FONT = Font(color="FF9C0006")
        WK = "#,##0"

        # ---- columnas fijas: identidad + presupuesto (idénticas al app) ----
        fixed = [
            "Project Category", "Phases", "Phases Subphase", "WBS Number",
            "Task Title", "Owner", "Budget Revised", "YTD Expense",
            "Remaining", "Forecast", "Funding Pending",
        ]
        FIX = len(fixed)  # 11
        hr = 5            # cabecera en fila 5 (3 filas de tiempo, como Job Cost)
        for i, h in enumerate(fixed, 1):
            c = ws.cell(hr, i, h)
            c.fill = HDR
            c.font = WHITE
            c.alignment = Alignment(wrap_text=True, vertical="center", horizontal="center")
        ws.row_dimensions[hr].height = 30

        # ---- columnas de tiempo: semana -> mes -> trimestre (como Job Cost) ----
        col = FIX + 1
        week_col: dict[dt.date, int] = {}
        month_col: dict[tuple[int, int], tuple[int, int, int]] = {}
        qtr_col: dict[str, tuple[int, list[int]]] = {}
        by_q: dict[str, dict[tuple[int, int], list[dt.date]]] = defaultdict(
            lambda: defaultdict(list)
        )
        for w in self.weeks:
            by_q[_quarter(w)][(w.year, w.month)].append(w)
        for qname, months in by_q.items():
            m_cols: list[int] = []
            for (yy, mm), wks in months.items():
                w_first = col
                for w in wks:
                    ws.cell(3, col, qname)
                    ws.cell(4, col, dt.date(yy, mm, 1).strftime("%b %Y").upper())
                    cc = ws.cell(hr, col, w.day)
                    cc.fill = SUBHDR
                    cc.font = Font(bold=True, size=9)
                    cc.alignment = Alignment(horizontal="center")
                    ws.column_dimensions[gc(col)].width = 5.5
                    week_col[w] = col
                    col += 1
                mc = ws.cell(hr, col, dt.date(yy, mm, 1).strftime("%b").upper())
                mc.fill = PatternFill("solid", fgColor="FFA2C4C9")
                mc.font = BOLD
                mc.alignment = Alignment(horizontal="center")
                ws.cell(3, col, qname)
                ws.cell(4, col, "MONTH")
                ws.column_dimensions[gc(col)].width = 11
                month_col[(yy, mm)] = (col, w_first, col - 1)
                m_cols.append(col)
                for k in range(w_first, col):
                    ws.column_dimensions[gc(k)].outlineLevel = 2
                col += 1
            qc = ws.cell(hr, col, qname)
            qc.fill = TOTAL
            qc.font = BOLD
            qc.alignment = Alignment(horizontal="center")
            ws.cell(3, col, qname)
            ws.cell(4, col, "QUARTER")
            ws.column_dimensions[gc(col)].width = 13
            qtr_col[qname] = (col, m_cols)
            for k in m_cols:
                ws.column_dimensions[gc(k)].outlineLevel = 1
            col += 1
        total_col = col
        tc = ws.cell(hr, col, "FULL YEAR")
        tc.fill = HDR
        tc.font = WHITE
        tc.alignment = Alignment(horizontal="center")
        ws.column_dimensions[gc(col)].width = 15

        # ---- rollup de tiempo de una fila (mes=SUM semanas, trim=SUM meses, total=SUM trim) ----
        def _rollup(row: int) -> None:
            for (_yy, _mm), (mc2, a, b) in month_col.items():
                ws.cell(row, mc2, f"=SUM({gc(a)}{row}:{gc(b)}{row})").number_format = MONEY
            for _qn, (qc2, mcs) in qtr_col.items():
                ws.cell(
                    row, qc2, _suma(f"{gc(m)}{row}" for m in mcs)
                ).number_format = MONEY
            ws.cell(
                row, total_col,
                _suma(f"{gc(q)}{row}" for q, _ in qtr_col.values()),
            ).number_format = MONEY

        # ---- datos: líneas de v_wbs_financials + montos por semana (dato base) ----
        rows = self.db.execute(
            text(
                """
                SELECT f.wbs_code, f.title, f.owner, f.category, f.phase, f.kind
                FROM v_wbs_financials f
                LEFT JOIN wbs_item w ON w.wbs_code = f.wbs_code
                LEFT JOIN category c ON c.id = w.category_id
                WHERE f.kind <> 'section_header'
                ORDER BY COALESCE(c.sort_order, 999),
                         COALESCE(f.category, 'zzz'), f.wbs_code
                """
            )
        ).mappings().all()
        sched: defaultdict[str, dict[dt.date, float]] = defaultdict(dict)
        for s in self.db.execute(
            text(
                """
                SELECT w.wbs_code, s.week_start, s.planned_amount
                FROM schedule_cell s
                JOIN wbs_item w ON w.id = s.wbs_id
                """
            )
        ).mappings():
            sched[(s["wbs_code"] or "").strip()][s["week_start"]] = float(
                s["planned_amount"] or 0
            )

        # Agrupar por categoría en el orden del Excel; sembrar TODAS las categorías
        # activas (incluidas las vacías, ej. Construction) como hace el app.
        groups: dict[str, list[RowMapping]] = {}
        for name in self.db.execute(
            text("SELECT name FROM category WHERE is_active ORDER BY sort_order, code")
        ).scalars():
            groups[(name or "").strip()] = []
        for e in rows:
            cat = (e["category"] or "No category").strip()
            groups.setdefault(cat, []).append(e)

        # ---- helpers de escritura ----
        def _cost_row(row: int, e: RowMapping) -> None:
            code = (e["wbs_code"] or "").strip()
            ws.cell(row, 1, (e["category"] or "").strip())
            ws.cell(row, 2, e["phase"])
            ws.cell(row, 3, "—")            # Phases Subphase (el app muestra "—")
            ws.cell(row, 4, code)
            ws.cell(row, 5, e["title"])
            ws.cell(row, 6, e["owner"])
            # Budget Revised / YTD / Remaining / Forecast desde Job Cost por WBS
            for i, src in zip(range(7, 11), "IJKL", strict=False):
                ws.cell(
                    row, i,
                    f"=SUMIF('Job Cost Report'!$B:$B,$D{row},"
                    f"'Job Cost Report'!${src}:${src})",
                ).number_format = MONEY
            ws.cell(row, 11, f"=J{row}-H{row}").number_format = MONEY  # Funding = FC-YTD
            row_sched = sched.get(code, {})
            for w, wc in week_col.items():
                if w not in row_sched:
                    continue
                v = row_sched[w]
                cell = ws.cell(row, wc)
                if v:
                    # ⚠️ T3 del audit: esto era el NÚMERO copiado del Job Cost.
                    # Daba igual hoy y se desincronizaba con cualquier cambio —
                    # que es la definición de una copia pegada. Ahora lo trae
                    # por fórmula de la columna de ESA MISMA SEMANA del Job
                    # Cost, que es la única fuente del cronograma.
                    jcr = self.week_col.get(w)
                    if jcr:
                        _w = gc(jcr)
                        cell.value = (
                            f"=SUMIF('Job Cost Report'!$B:$B,$D{row},"
                            f"'Job Cost Report'!{_w}:{_w})"
                        )
                    else:
                        cell.value = round(v, 2)
                    cell.number_format = WK
                cell.fill = self._cat_fill(e["category"], bool(v))  # color de categoría, igual que el app
            _rollup(row)

        def _venta_row(row: int, label: str, codes: list[str]) -> None:
            for i, src in zip(range(7, 11), "IJKL", strict=False):
                ws.cell(
                    row, i,
                    _suma(
                        f"SUMIF('Job Cost Report'!$B:$B,\"{cd}\","
                        f"'Job Cost Report'!${src}:${src})"
                        for cd in codes
                    ),
                ).number_format = MONEY
            ws.cell(row, 11, f"=J{row}-H{row}").number_format = MONEY
            for w, wc in week_col.items():
                v = sum(sched.get(cd, {}).get(w, 0.0) for cd in codes)
                if v:
                    # Mismo criterio que la línea de detalle (T3), pero sumando
                    # los códigos que la venta agrupa.
                    jcr = self.week_col.get(w)
                    if jcr:
                        _w = gc(jcr)
                        ws.cell(row, wc, _suma(
                            f"SUMIF('Job Cost Report'!$B:$B,\"{cd}\","
                            f"'Job Cost Report'!{_w}:{_w})"
                            for cd in codes
                        )).number_format = WK
                    else:
                        ws.cell(row, wc, round(v, 2)).number_format = WK
            _rollup(row)
            lab = ws.cell(row, 1, label)
            lab.font = BOLD
            for i in range(1, total_col + 1):
                ws.cell(row, i).fill = VENTA_FILL

        def _sum_row(row: int, label: str, idxs: list[int], fill: PatternFill) -> None:
            for i in range(7, 11):
                ws.cell(
                    row, i,
                    _suma(f"{gc(i)}{x}" for x in idxs),
                ).number_format = MONEY
            ws.cell(row, 11, f"=J{row}-H{row}").number_format = MONEY
            for wc in week_col.values():
                if idxs:
                    ws.cell(
                        row, wc, _suma(f"{gc(wc)}{x}" for x in idxs)
                    ).number_format = WK
            _rollup(row)
            lab = ws.cell(row, 1, label)
            lab.font = BOLD
            for i in range(1, total_col + 1):
                ws.cell(row, i).fill = fill

        # ---- cuerpo: categoría (cabecera + gastos + subtotal[s]) ----
        r = hr + 1
        subtotal_rows: list[int] = []
        for cat, lines in groups.items():
            for i in range(1, total_col + 1):
                ws.cell(r, i).fill = CAT_FILL
            ws.cell(r, 1, cat.upper()).font = BOLD
            r += 1

            costs = [e for e in lines if e["kind"] != "proceeds"]
            sales = [e for e in lines if e["kind"] == "proceeds"]

            cost_idx: list[int] = []
            for e in costs:
                _cost_row(r, e)
                cost_idx.append(r)
                r += 1

            if sales:
                _sum_row(r, "TOTAL EXPENSES", cost_idx, GASTO_FILL)
                subtotal_rows.append(r)
                r += 1
                sale_codes = [(e["wbs_code"] or "").strip() for e in sales]
                _venta_row(r, "TOTAL SALES · " + ", ".join(sale_codes), sale_codes)
                subtotal_rows.append(r)
                r += 1
            else:
                _sum_row(r, f"TOTAL {cat.upper()}", cost_idx, GASTO_FILL)
                subtotal_rows.append(r)
                r += 1

        # ---- PROJECT TOTAL: suma TODAS las líneas (= suma de todos los subtotales) ----
        _sum_row(r, "PROJECT TOTAL", subtotal_rows, TOTAL)
        last = r
        r += 1

        # ---- Remaining / Funding negativos en rojo (como el app) ----
        for col_l in ("I", "K"):
            ws.conditional_formatting.add(
                f"{col_l}{hr + 1}:{col_l}{last}",
                CellIsRule(operator="lessThan", formula=["0"], fill=RED_FILL, font=RED_FONT),
            )

        for c, wdt in zip(
            range(1, FIX + 1), [16, 12, 12, 12, 42, 14, 14, 13, 13, 13, 14], strict=False
        ):
            ws.column_dimensions[gc(c)].width = wdt
        ws.freeze_panes = ws.cell(hr + 1, FIX + 1)

    # ------------------------------------------------------------------ 5
    def _sheet_dashboard(self) -> None:
        """Réplica FORMULADA de la vista Dashboard del app.

        KPIs (Presupuesto revisado / Gasto a la fecha / Remanente / % ejecutado)
        y tabla por categoría con TOTAL GASTOS / TOTAL VENTA (kind='proceeds') y
        GRAN TOTAL. TODO por fórmula viva referenciando 'Job Cost Report':
          * Presupuesto = SUMIF(...$B:$B, wbs, ...$I:$I)   (Budget Revised)
          * Gasto       = SUMIF(...$B:$B, wbs, ...$J:$J)   (Spend = SUMIF al LEDGER)
          * Remanente   = SUMIF(...$B:$B, wbs, ...$K:$K)   (Remaining)
        Los subtotales/GRAN TOTAL suman celdas vivas; el % = Gasto/Presupuesto.
        La línea de venta NO se lista: aparece sólo como TOTAL VENTA.
        """
        ws = self.wb.create_sheet("Dashboard")
        PCT = "0.0%;[Red](0.0%)"
        VENTA_FILL = PatternFill("solid", fgColor="FFDFF3E3")   # verde venta
        VENTA_FONT = Font(bold=True, color="FF38761D")
        KPI_LBL = Font(size=9, color="FF808080")
        KPI_VAL = Font(bold=True, size=16)
        JC = "'Job Cost Report'"

        def sumif(code: str, col: str) -> str:
            c = (code or "").replace('"', '""')
            return f'SUMIF({JC}!$B:$B,"{c}",{JC}!${col}:${col})'

        ws["A1"] = "DASHBOARD VENTANAS — Summary"
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = "Live model. Edit the LEDGER / Job Cost and everything recalculates."
        ws["A2"].font = Font(italic=True, color="FF808080")

        # --- datos (v_wbs_financials, mismo origen que Job Cost) ------------
        rows = self.db.execute(
            text(
                """
                SELECT f.wbs_code, f.title, f.state, f.kind, f.category,
                       f.budget_original, f.budget_change
                FROM v_wbs_financials f
                LEFT JOIN wbs_item w ON w.wbs_code = f.wbs_code
                WHERE f.kind <> 'section_header'
                ORDER BY COALESCE(f.category, 'zzz'), w.sort_order, f.wbs_code
                """
            )
        ).mappings().all()

        # agrupar por categoría preservando el orden de llegada de las líneas
        groups: dict[str, list[RowMapping]] = defaultdict(list)
        for e in rows:
            groups[(e["category"] or "No category").strip()].append(e)
        # el app ordena las categorías por presupuesto revisado descendente
        def cat_budget(lines: list[RowMapping]) -> float:
            return sum(
                float(ln["budget_original"] or 0) + float(ln["budget_change"] or 0)
                for ln in lines
            )
        ordered = sorted(groups.items(), key=lambda kv: cat_budget(kv[1]), reverse=True)

        # --- cabecera de la tabla ------------------------------------------
        hr = 7
        # D1 del audit: el WBS, que faltaba. Sin el, cada SUMIF llevaba el
        # codigo escrito dentro y la fila no se podia copiar ni auditar: habia
        # que abrir la formula para saber a que linea miraba.
        heads = ["Category / line", "WBS", "Status", "Budget", "Spend", "Remaining"]
        NCOL = len(heads)
        C_WBS, C_EST, C_PRE, C_GAS, C_REM = 2, 3, 4, 5, 6
        for i, h in enumerate(heads, 1):
            c = ws.cell(hr, i, h)
            c.fill = HDR
            c.font = WHITE
            c.alignment = Alignment(
                horizontal="left" if i == 1 else ("center" if i <= 3 else "right")
            )

        cost_totals: list[int] = []   # filas TOTAL / TOTAL EXPENSES
        sale_totals: list[int] = []   # filas TOTAL SALES
        r = hr + 1
        for cat, lines in ordered:
            # fila de categoría
            for i in range(1, NCOL + 1):
                ws.cell(r, i).fill = CATF
            cc = ws.cell(r, 1, cat.upper())
            cc.font = BOLD
            r += 1

            costs = [ln for ln in lines if ln["kind"] != "proceeds"]
            sales = [ln for ln in lines if ln["kind"] == "proceeds"]

            cost_line_rows: list[int] = []
            for ln in costs:
                code = (ln["wbs_code"] or "").strip()
                ws.cell(r, 1, ln["title"]).alignment = Alignment(indent=1)
                wc = ws.cell(r, C_WBS, code)
                wc.alignment = Alignment(horizontal="center")
                # D2: el estado tambien se busca, no se pega. Si alguien lo
                # cambia en el Job Cost, el Dashboard lo sigue; antes se
                # quedaba con el estado del dia que se bajo el archivo.
                ws.cell(
                    r, C_EST,
                    f'=IFERROR(XLOOKUP(${gc(C_WBS)}{r},{JC}!$B:$B,{JC}!$A:$A),"")',
                ).alignment = Alignment(horizontal="center")
                ws.cell(r, C_EST).fill = STATE_FILL.get(
                    ln["state"], STATE_FILL["not_started"]
                )
                # D1: SUMIF por la celda B de la fila -> la fila se copia.
                for col, src in ((C_PRE, "I"), (C_GAS, "J"), (C_REM, "K")):
                    ws.cell(
                        r, col,
                        f"=SUMIF({JC}!$B:$B,${gc(C_WBS)}{r},{JC}!${src}:${src})",
                    ).number_format = MONEY
                cost_line_rows.append(r)
                r += 1

            def _total(rr: int, etq: str, filas: list[int],
                       fill: PatternFill, font: Font) -> None:
                for i in range(1, NCOL + 1):
                    ws.cell(rr, i).fill = fill
                e = ws.cell(rr, C_EST, etq)
                e.font = font
                e.alignment = Alignment(horizontal="right")
                for col in (C_PRE, C_GAS, C_REM):
                    ws.cell(rr, col, _suma(f"{gc(col)}{x}" for x in filas))
                    ws.cell(rr, col).number_format = MONEY
                    ws.cell(rr, col).font = font

            if not sales:
                _total(r, "TOTAL", cost_line_rows, TOTAL, BOLD)
                cost_totals.append(r)
                r += 1
            else:
                _total(r, "TOTAL EXPENSES", cost_line_rows, TOTAL, BOLD)
                cost_totals.append(r)
                r += 1
                # TOTAL VENTA (kind='proceeds') — no se lista, sólo el subtotal
                codes = [(ln["wbs_code"] or "").strip() for ln in sales]
                for i in range(1, NCOL + 1):
                    ws.cell(r, i).fill = VENTA_FILL
                ws.cell(r, C_WBS, ", ".join(codes)).alignment = Alignment(
                    horizontal="center"
                )
                e = ws.cell(r, C_EST, "TOTAL SALES")
                e.font = VENTA_FONT
                e.alignment = Alignment(horizontal="right")
                for col, src in ((C_PRE, "I"), (C_GAS, "J"), (C_REM, "K")):
                    ws.cell(r, col, _suma(sumif(c, src) for c in codes))
                    ws.cell(r, col).number_format = MONEY
                    ws.cell(r, col).font = VENTA_FONT
                sale_totals.append(r)
                r += 1

        # --- Totales: gasto y venta POR SEPARADO ---------------------------
        #
        # ⚠️ D4 del audit: el GRAN TOTAL sumaba las dos cosas. La venta de
        # Ventanas entra con signo negativo (−480,000), asi que el presupuesto
        # del proyecto se mostraba en 20,338,191.73 cuando el gasto
        # presupuestado es 20,818,191.73, y el % ejecutado salia 59.5% en vez
        # de 58.1%. Nada fallaba: solo daba el numero equivocado.
        def _gran(rr: int, etq: str, filas: list[int], fill: PatternFill) -> int:
            for i in range(1, NCOL + 1):
                ws.cell(rr, i).fill = fill
            g = ws.cell(rr, 1, etq)
            g.font = Font(bold=True, size=11)
            for col in (C_PRE, C_GAS, C_REM):
                ws.cell(rr, col, _suma(f"{gc(col)}{x}" for x in filas))
                ws.cell(rr, col).number_format = MONEY
                ws.cell(rr, col).font = Font(bold=True, size=11)
            return rr

        gt_row = _gran(r, "TOTAL EXPENSES — PROJECT", cost_totals, TOTAL)
        r += 1
        if sale_totals:
            _gran(r, "TOTAL SALES — PROJECT", sale_totals, VENTA_FILL)
            r += 1
            _gran(r, "NET (EXPENSES + SALES)", cost_totals + sale_totals, TOTAL)
            r += 1

        # --- KPIs (referencian el total de GASTO, fórmulas vivas) ----------
        P, G, M = gc(C_PRE), gc(C_GAS), gc(C_REM)
        kpis = [
            (1, "Revised Budget", f"={P}{gt_row}", MONEY),
            (2, "Spend to Date", f"={G}{gt_row}", MONEY),
            (3, "Remaining", f"={M}{gt_row}", MONEY),
            (4, "% Executed", f"=IFERROR({G}{gt_row}/{P}{gt_row},0)", PCT),
        ]
        for col, lbl, formula, fmt in kpis:
            lc = ws.cell(4, col, lbl)
            lc.font = KPI_LBL
            vc = ws.cell(5, col, formula)
            vc.number_format = fmt
            vc.font = KPI_VAL

        for c, w in zip(range(1, NCOL + 1), [40, 12, 16, 16, 16, 16], strict=False):
            ws.column_dimensions[gc(c)].width = w
        ws.freeze_panes = ws.cell(hr + 1, 1)

    def _sheet_short_payment(self) -> None:
        """Short Payment List — RÉPLICA de ShortPaymentsView.tsx, pero formulada.

        Una sección por tanda (cada disbursement): barra de título
        'To be sent <fecha> · Desembolso #<no>.<sub> · <estado>', fila de
        encabezados de columna, las líneas del desembolso y una fila TOTAL con
        SUM viva sobre la columna Monto. El total de la barra de título es una
        referencia viva a esa misma suma.

        Columnas EXACTAS del app (LineRow):
          #, WBS, Descripción, Factura #, Nota, Categoría / Tipo, Nombre,
          Transfer, [Banco, Beneficiario, IBAN / Cuenta], Monto
        Las 3 columnas bancarias solo aparecen si algún renglón trae banco/IBAN
        (misma regla `showBank` del front). El delete-column de la vista no se
        exporta.
        """
        ws = self.wb.create_sheet("Short Payment")

        # STATUS_LABEL del front (ShortPaymentsView.tsx)
        STATUS_LABEL = {
            "draft": "Draft",
            "submitted": "Submitted to corporate",
            "approved": "Approved",
            "funded": "Wire received",
            "transferred": "Transferred to LAFISE",
            "settled": "Settled",
            "cancelled": "Cancelled",
        }
        MESES = [
            "", "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ]

        # Misma consulta que repo.short_payments(): WBS/Categoría/Tipo se
        # resuelven por línea y se heredan del WBS si la línea no los trae.
        rows = self.db.execute(
            text(
                """
                SELECT d.id, d.disb_no, d.disb_sub, d.period_month, d.send_date, d.status,
                       d.total_amount, d.credit_applied,
                       dl.id AS line_id, dl.line_no, dl.description, dl.invoice_no,
                       dl.amount, dl.reason, dl.transfer,
                       w.wbs_code, w.title AS wbs_title,
                       COALESCE(cl.name, cw.name) AS category,
                       COALESCE(pl.name, pw.name) AS type,
                       p.name AS payee_name,
                       -- ⚠️ El banco se hereda del holding cuando el proveedor
                       -- no trae uno propio, igual que la pantalla
                       -- (repositories/disbursement.py) y el PDF de Breakdown.
                       -- Sin esto 135 de 222 lineas salian con el banco en
                       -- blanco: justo la cuenta a la que entra la plata.
                       COALESCE(p.bank_name,
                                CASE WHEN dl.id IS NULL THEN NULL ELSE :holding END)
                         AS bank_name,
                       p.legal_id, p.iban
                FROM disbursement d
                LEFT JOIN disbursement_line dl ON dl.disbursement_id = d.id
                LEFT JOIN payee p    ON p.id  = dl.payee_id
                LEFT JOIN wbs_item w ON w.id  = dl.wbs_id
                LEFT JOIN category cl ON cl.id = dl.category_id
                LEFT JOIN phase    pl ON pl.id = dl.phase_id
                LEFT JOIN category cw ON cw.id = w.category_id
                LEFT JOIN phase    pw ON pw.id = w.phase_id
                ORDER BY d.disb_no, d.disb_sub, dl.line_no
                """
            ),
            {"holding": HOLDING_BANK},
        ).mappings().all()

        if not rows:
            ws["A1"] = (
                "No payment batches yet. They are created from the "
                "Disbursements tab (or when importing from Excel)."
            )
            ws["A1"].font = Font(italic=True, color="FF808080")
            ws.column_dimensions["A"].width = 80
            return

        # showBank: igual que el front (algún renglón con banco o IBAN)
        show_bank = any((r["bank_name"] or r["iban"]) for r in rows)

        base = ["#", "WBS", "Description", "Invoice #", "Note",
                "Category / Type", "Name", "Transfer"]
        if show_bank:
            base += ["Bank", "Beneficiary", "IBAN / Account"]
        base += ["Amount"]
        monto_col = len(base)           # última columna
        col_letter = gc(monto_col)

        widths = {
            "#": 5, "WBS": 12, "Description": 42, "Invoice #": 12, "Note": 24,
            "Category / Type": 20, "Name": 24, "Transfer": 10,
            "Bank": 18, "Beneficiary": 18, "IBAN / Account": 26, "Amount": 15,
        }
        for i, h in enumerate(base, 1):
            ws.column_dimensions[gc(i)].width = widths.get(h, 14)

        # Agrupar por tanda conservando el orden de la consulta.
        batches: dict[int, dict[str, Any]] = {}
        order: list[int] = []
        for row in rows:
            bid = row["id"]
            if bid not in batches:
                batches[bid] = {"head": row, "lines": []}
                order.append(bid)
            if row["line_no"] is not None:
                batches[bid]["lines"].append(row)

        LEFT = Alignment(horizontal="left", vertical="center", wrap_text=True)
        RIGHT = Alignment(horizontal="right", vertical="center")

        r = 1
        for bid in order:
            head = batches[bid]["head"]
            lines = batches[bid]["lines"]

            if head["send_date"]:
                d = head["send_date"]
                date_str = f"{MESES[d.month]} {d.day}, {d.year}"
            else:
                d = head["period_month"]
                date_str = f"{MESES[d.month]} {d.year}"
            status_label = STATUS_LABEL.get(head["status"], head["status"])
            title = (
                f"To be sent {date_str}   ·   "
                f"Disbursement #{head['disb_no']}.{head['disb_sub']} · {status_label}"
            )

            # --- Barra de título (navy en el app -> HDR + fuente blanca) ---
            sr = r
            for c in range(1, monto_col + 1):
                ws.cell(sr, c).fill = HDR
            ws.merge_cells(start_row=sr, start_column=1, end_row=sr, end_column=monto_col - 1)
            tc = ws.cell(sr, 1, title)
            tc.font = WHITE
            tc.alignment = Alignment(horizontal="left", vertical="center")
            ws.row_dimensions[sr].height = 18

            # --- Encabezados de columna ---
            hr = sr + 1
            for i, h in enumerate(base, 1):
                c = ws.cell(hr, i, h)
                c.fill = SUBHDR
                c.font = BOLD
                c.alignment = RIGHT if i == monto_col else LEFT

            # --- Líneas del desembolso (datos base = valores) ---
            dr = hr + 1
            rr = dr
            for ln in lines:
                ws.cell(rr, 1, ln["line_no"])
                ws.cell(rr, 2, (ln["wbs_code"] or "")).font = Font(name="Consolas", size=10)
                ws.cell(rr, 3, ln["description"])
                ws.cell(rr, 4, ln["invoice_no"])
                ws.cell(rr, 5, ln["reason"])
                # Categoría / Tipo en una sola celda (categoría arriba, tipo abajo)
                cat = ln["category"] or ""
                typ = ln["type"] or ""
                ct_txt = f"{cat}\n{typ}" if cat and typ else cat or typ
                ct = ws.cell(rr, 6, ct_txt)
                ct.alignment = Alignment(wrap_text=True, vertical="top")
                ws.cell(rr, 7, ln["payee_name"])
                ws.cell(rr, 8, ln["transfer"])
                col = 9
                if show_bank:
                    ws.cell(rr, col, ln["bank_name"])  # Banco
                    ws.cell(rr, col + 1, ln["legal_id"])  # Beneficiario
                    ws.cell(rr, col + 2, ln["iban"])  # IBAN / Cuenta
                    col += 3
                mc = ws.cell(rr, monto_col, float(ln["amount"] or 0))
                mc.number_format = MONEY
                mc.alignment = RIGHT
                rr += 1
            last = rr - 1

            # --- Fila TOTAL (SUM viva) ---
            tr = rr
            for c in range(1, monto_col + 1):
                ws.cell(tr, c).fill = TOTAL
            ws.merge_cells(start_row=tr, start_column=1, end_row=tr, end_column=monto_col - 1)
            tl = ws.cell(tr, 1, "Total")
            tl.font = BOLD
            tl.alignment = Alignment(horizontal="left", vertical="center")
            if lines:
                # ⚠️ `disbursement.total_amount` = suma de lineas MENOS el credito
                # aplicado (lo mantiene el trigger sync_credit_applied), y es lo
                # que la app pinta en la barra. Sumar las lineas a secas
                # sobreestima la tanda en cuanto se aplique un credito, sin que
                # nada avise. Hoy credit_applied es 0 en las 25 tandas: el error
                # estaria dormido hasta el dia que se use la hoja Credits.
                credito = float(head["credit_applied"] or 0)
                formula = f"=SUM({col_letter}{dr}:{col_letter}{last})"
                if credito:
                    formula += f"-{credito}"
                total_cell = ws.cell(tr, monto_col, formula)
            else:
                total_cell = ws.cell(tr, monto_col, 0)
            total_cell.number_format = MONEY
            total_cell.font = BOLD
            total_cell.alignment = RIGHT

            # Total de la barra de título = referencia VIVA a la suma del pie.
            ht = ws.cell(sr, monto_col, f"={col_letter}{tr}")
            ht.number_format = MONEY
            ht.font = WHITE
            ht.alignment = RIGHT

            # Siguiente tanda: fila en blanco de separación.
            r = tr + 2

        ws.sheet_view.showGridLines = False

    # ------------------------------------------------------------------ 5
    def _sheet_creditos(self) -> None:
        """Estado de cuenta de crédito — RÉPLICA de CreditView.tsx, FORMULADA.

        Encabezado con Acumulado / Aplicado / Disponible (fórmulas vivas sobre
        la tabla) + estado de cuenta con SALDO CORRIDO por fórmula
        (saldo fila anterior + movimiento de la fila), igual que v_credit_ledger.

        Fuente: v_credit_ledger (move_date, kind, description, amount) — que a su
        vez une accrual (ledger liberado), adjustment (credit_adjustment) y
        application (credit_application). El saldo y los KPIs del header son
        FÓRMULA, no valores pegados.
        """
        ws = self.wb.create_sheet("Credits")
        DATEF = "yyyy-mm-dd"

        # Etiquetas de movimiento — mismas que KIND_LABEL en el front
        KIND_LABEL = {
            "accrual": "Accrual (released ledger)",
            "adjustment": "Manual adjustment",
            "application": "Applied to disbursement",
        }
        APP_LABEL = KIND_LABEL["application"]  # ancla para el SUMIF de "Aplicado"

        ws["A1"] = "DASHBOARD VENTANAS — Credit Account Statement"
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = "Live model. Running balance and KPIs by formula."
        ws["A2"].font = Font(italic=True, color="FF808080")

        # --- Tabla: estado de cuenta (saldo corrido) --------------------
        heads = ["Date", "Movement", "Detail", "Amount", "Balance"]
        hr = 7
        for i, h in enumerate(heads, 1):
            c = ws.cell(hr, i, h)
            c.fill = HDR
            c.font = WHITE
            c.alignment = Alignment(horizontal="center")

        rows = self.db.execute(
            text(
                """
                SELECT move_date, kind, description, amount
                FROM v_credit_ledger
                -- El saldo corrido se arma como =E(fila-1)+D(fila): solo es
                -- correcto si las filas llegan ordenadas. La vista trae su
                -- propio ORDER BY, pero eso no es una garantia del motor.
                ORDER BY move_date, kind
                """
            )
        ).mappings().all()

        first = hr + 1
        r = first
        for e in rows:
            ws.cell(r, 1, e["move_date"]).number_format = DATEF
            ws.cell(r, 2, KIND_LABEL.get(e["kind"], e["kind"]))
            ws.cell(r, 3, e["description"])
            ws.cell(r, 4, float(e["amount"] or 0)).number_format = MONEY
            # SALDO CORRIDO vivo: primera fila = su monto; resto = saldo previo + monto
            if r == first:
                ws.cell(r, 5, f"=D{r}").number_format = MONEY
            else:
                ws.cell(r, 5, f"=E{r - 1}+D{r}").number_format = MONEY
            ws.cell(r, 5).font = BOLD
            r += 1
        last = r - 1
        has_rows = last >= first

        if not has_rows:
            ws.cell(first, 1, "No credit movements yet.")
            ws.merge_cells(start_row=first, start_column=1, end_row=first, end_column=5)
            ws.cell(first, 1).alignment = Alignment(horizontal="center")
            ws.cell(first, 1).font = Font(italic=True, color="FF808080")

        # --- Encabezado KPIs: Acumulado / Aplicado / Disponible ---------
        # Fórmulas vivas (replican v_credit_balance):
        #   aplicado   = -SUM(amount) FILTER (kind = 'application')
        #   acumulado  =  SUM(amount) FILTER (kind <> 'application')
        #   disponible =  SUM(amount)  (= último saldo corrido)
        # CR1 del audit: con la tabla vacia los tres KPI eran el TEXTO "0" —
        # ni siquiera un cero. Quien escribiera los movimientos a mano en Excel
        # se quedaba con tres ceros muertos arriba. El rango se abre igual
        # cuando no hay filas, sobre las 30 lineas siguientes a la nota.
        ini, fin = (first, last) if has_rows else (first + 1, first + 30)
        amt = f"$D${ini}:$D${fin}"
        mov = f"$B${ini}:$B${fin}"
        f_aplicado = f'=-SUMIF({mov},"{APP_LABEL}",{amt})'
        f_acumulado = f'=SUM({amt})-SUMIF({mov},"{APP_LABEL}",{amt})'
        f_disponible = f"=SUM({amt})"

        cards = [
            (1, "Accrued", f_acumulado),
            (2, "Applied", f_aplicado),
            (3, "Available", f_disponible),
        ]
        for col, label, formula in cards:
            lc = ws.cell(4, col, label)
            lc.font = Font(bold=True, color="FF808080", size=9)
            lc.fill = SUBHDR
            lc.alignment = Alignment(horizontal="center")
            vc = ws.cell(5, col, formula)
            vc.number_format = MONEY
            vc.font = Font(bold=True, size=13)
            vc.fill = TOTAL
            vc.alignment = Alignment(horizontal="center")

        # anchos y freeze
        for c, w in zip(range(1, 6), [14, 30, 52, 16, 16], strict=False):
            ws.column_dimensions[gc(c)].width = w
        ws.freeze_panes = f"A{first}"
        if has_rows:
            ws.auto_filter.ref = f"A{hr}:E{last}"

    def _sheet_bancos(self) -> None:
        """Estado de cuenta por cada bank_account (réplica de BankView →
        AccountStatement) con SALDO ENCADENADO por fórmula viva.

        Réplica exacta de la vista del app:
          - columnas: Fecha · Nº · Descripción · Débito · Crédito · Cuenta · Tipo · Saldo
          - fila "Saldo inicial" (valor base) + movimientos + fila "Saldo final".
        Regla de oro: el saldo NO se pega — cada fila es
            saldo = saldo_anterior + crédito − débito  (fórmula viva).
        El saldo inicial se deriva igual que el front:
            opening = primer_balance − (primer_credito − primer_debito).
        """
        ws = self.wb.create_sheet("Banks")
        ws["A1"] = "DASHBOARD VENTANAS — Banks (Account statement)"
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = "Live model: each balance = previous balance + credit − debit."
        ws["A2"].font = Font(italic=True, color="FF808080")

        DATEF = "yyyy-mm-dd"  # formato de fecha local a esta hoja
        headers = [
            "Date", "No.", "Description", "Debit", "Credit", "Account", "Type",
            # ⚠️ Dos definiciones distintas de "saldo". La H la calculamos
            # nosotros encadenando movimiento a movimiento; la I es la que
            # reporta el banco —y es la que la app llama "Balance". Con el
            # mismo rotulo se leen una por la otra: en LAFISE difieren
            # $92,750.02 al cierre.
            "Balance (chained)",
            # ⚠️ B2 del audit: las dos columnas que faltaban. El saldo de la H
            # se encadena desde los debitos y creditos; el banco reporta el
            # suyo en cada movimiento. Mientras no se comparen, un faltante en
            # el detalle no se ve: la cadena sigue cuadrando consigo misma.
            "Balance (bank)", "Difference",
        ]
        COL_BANCO, COL_DIF = 9, 10

        accounts = self.db.execute(
            text("SELECT id, name FROM bank_account ORDER BY name")
        ).mappings().all()
        # nombre de cuenta -> fila del "Closing balance" (la cita US Wire)
        self.cierre_banco: dict[str, int] = {}

        r = 4
        for acc in accounts:
            # --- título de la cuenta ---
            for i in range(1, len(headers) + 1):
                ws.cell(r, i).fill = CATF
            ws.cell(r, 1, acc["name"]).font = Font(bold=True, size=12)
            r += 1

            # --- cabecera ---
            for i, h in enumerate(headers, 1):
                c = ws.cell(r, i, h)
                c.fill = HDR
                c.font = WHITE
                c.alignment = Alignment(horizontal="center")
            r += 1

            # Réplica del SELECT statement() del repositorio (bank_tx), más el
            # label del tipo (bank_movement_class) que el front mapea client-side.
            rows = self.db.execute(
                text(
                    """
                    SELECT t.id, t.tx_date, t.txn_no, t.description,
                           t.debit, t.credit, a.name AS account_name,
                           mc.label AS class_label, t.balance
                    FROM bank_tx t
                    LEFT JOIN bank_account a         ON a.id = t.account_id
                    LEFT JOIN bank_movement_class mc ON mc.code = t.class_code
                    WHERE t.account_id = :aid
                    ORDER BY t.tx_date, t.id
                    """
                ),
                {"aid": acc["id"]},
            ).mappings().all()

            if not rows:
                ws.cell(r, 1, "This account has no movements.").font = Font(
                    italic=True, color="FF808080"
                )
                r += 2
                continue

            # --- Saldo inicial (valor base, igual que el app) ---
            first = rows[0]
            net_first = float(first["credit"] or 0) - float(first["debit"] or 0)
            opening = (
                float(first["balance"]) - net_first
                if first["balance"] is not None
                else 0.0
            )
            opening_row = r
            for i in range(1, len(headers) + 1):
                ws.cell(r, i).fill = SUBHDR
            ws.cell(r, 3, "Opening balance").font = BOLD
            oc = ws.cell(r, 8, round(opening, 2))
            oc.number_format = MONEY
            oc.font = BOLD
            r += 1

            # --- movimientos con saldo corrido VIVO ---
            prev_saldo = f"H{opening_row}"
            for e in rows:
                ws.cell(r, 1, e["tx_date"]).number_format = DATEF
                ws.cell(r, 2, e["txn_no"])
                ws.cell(r, 3, e["description"])
                ws.cell(r, 4, float(e["debit"] or 0)).number_format = MONEY
                ws.cell(r, 5, float(e["credit"] or 0)).number_format = MONEY
                ws.cell(r, 6, e["account_name"])
                ws.cell(r, 7, e["class_label"])
                # saldo = saldo anterior + crédito(E) − débito(D)  → fórmula viva
                ws.cell(r, 8, f"={prev_saldo}+E{r}-D{r}").number_format = MONEY
                # ⚠️ El saldo que el banco reporta en ESTA fila, y la diferencia
                # contra el nuestro. Antes solo se escribia el del ultimo
                # movimiento, asi que el descuadre aparecia agregado al pie y no
                # habia manera de saber en que movimiento empezo. En LAFISE son
                # $92,750.02 que arrancan en la fila 296 —el primer duplicado—
                # y nadie podia verlo.
                if e["balance"] is not None:
                    bc = ws.cell(r, COL_BANCO, round(float(e["balance"]), 2))
                    bc.number_format = MONEY
                    ws.cell(
                        r, COL_DIF, f"=ROUND({gc(COL_BANCO)}{r}-H{r},2)"
                    ).number_format = MONEY
                prev_saldo = f"H{r}"
                r += 1

            last_data_row = r - 1
            # Rojo en cada fila que no cuadre. Excel lee la celda vacia como 0,
            # asi que las filas sin saldo del banco no se pintan.
            ws.conditional_formatting.add(
                f"{gc(COL_DIF)}{opening_row + 1}:{gc(COL_DIF)}{last_data_row}",
                CellIsRule(
                    operator="notEqual",
                    formula=["0"],
                    fill=PatternFill("solid", fgColor="FFF4CCCC"),
                    font=Font(color="FF9C0006"),
                ),
            )
            # --- Saldo final = último saldo corrido (fórmula viva) ---
            for i in range(1, len(headers) + 1):
                ws.cell(r, i).fill = TOTAL
            ws.cell(r, 3, "Closing balance").font = BOLD
            fc = ws.cell(r, 8, f"=H{last_data_row}")
            fc.number_format = MONEY
            fc.font = BOLD
            # El saldo que reporta el BANCO en el ultimo movimiento. Es dato
            # del estado de cuenta, no un calculo nuestro: por eso va pegado.
            saldo_banco = rows[-1]["balance"]
            if saldo_banco is None:
                # Una celda vacia y una diferencia de cero se leen igual, y no
                # son lo mismo: esta cuenta no trae saldo del banco en ninguna
                # fila, asi que no hay con que contrastarla. Hay que decirlo.
                nc = ws.cell(r, COL_BANCO, "sin saldo reportado por el banco")
                nc.font = Font(italic=True, color="FF808080", size=9)
            if saldo_banco is not None:
                bc = ws.cell(r, COL_BANCO, round(float(saldo_banco), 2))
                bc.number_format = MONEY
                bc.font = BOLD
                dc = ws.cell(r, COL_DIF, f"=ROUND({gc(COL_BANCO)}{r}-H{r},2)")
                dc.number_format = MONEY
                dc.font = BOLD
                # En rojo cuando no cuadra, que es el unico caso que importa.
                ws.conditional_formatting.add(
                    f"{gc(COL_DIF)}{r}",
                    CellIsRule(
                        operator="notEqual", formula=["0"],
                        fill=PatternFill("solid", fgColor="FFF4CCCC"),
                        font=Font(bold=True, color="FF9C0006"),
                    ),
                )
            self.cierre_banco[acc["name"]] = r
            r += 2  # línea en blanco entre cuentas

        for c, w in zip(
            range(1, 11), [12, 10, 46, 14, 14, 22, 20, 16, 16, 16], strict=False
        ):
            ws.column_dimensions[gc(c)].width = w
        ws.freeze_panes = "A4"

    def _sheet_wires(self) -> None:
        """US Wire Transfers — réplica FORMULADA de la vista del app (UsWiresView.tsx).

        Aportes de los dueños al proyecto. Dos columnas de monto:
          - Enviado por dueños  (amount_sent, dato base; en blanco si NULL -> "—")
          - Recibido en LAFISE  (amount_received, dato base editable)
        y un SALDO LAFISE corrido por FÓRMULA VIVA (saldo anterior + recibido),
        continuo a través de los bloques en el orden en que los muestra el app.

        Estructura espejo: bloque "Ventanas I" (escrow) + bloque "Ventanas II"
        (Disbursement Requests), cada uno con su banda de bloque, sus filas y un
        subtotal (recibido) por fórmula; al pie "TOTAL TRANSFER" (enviado /
        recibido / saldo) y la métrica superior referencia esa fila. El "LAFISE
        Balance" (settings.lafise_balance) es un dato base manual al pie.
        """
        ws = self.wb.create_sheet("US Wire Transfers")

        # --- estilos locales de esta hoja (colores del app) ---
        NAVY = PatternFill("solid", fgColor="FF2D3A5C")        # cabecera de tabla (#2d3a5c)
        BLOCK_FILL = PatternFill("solid", fgColor="FFEAF0FA")   # banda de bloque (#EAF0FA)
        SUB_FILL = PatternFill("solid", fgColor="FFDCE6F4")     # fila subtotal (#DCE6F4)
        NOTE_FONT = Font(italic=True, color="FF808080", size=9)
        LBL_FONT = Font(bold=True, color="FF64748B", size=9)
        GREEN = Font(bold=True, color="FF047857")               # "Recibido" en verde (emerald)
        DATEF = "yyyy-mm-dd"
        RIGHT = Alignment(horizontal="right")

        # bloques en el MISMO orden que la vista (constante BLOCKS de UsWiresView.tsx)
        BLOCKS = [
            ("ventanas_i", "Ventanas I",
             "Contributions to escrow (Hovde Master -> Alta Batalla Escrow)"),
            ("ventanas_ii", "Ventanas II",
             "Disbursement Requests (Hovde Master -> SunWest -> Escrow)"),
        ]

        # --- datos base (mismo SELECT del router us_wires.list_us_wires) ---
        rows = list(
            self.db.execute(
                text(
                    """
                    SELECT id, block, trans_label, wire_date, sender,
                           from_party, to_party, account_number,
                           amount_received, amount_sent, notas
                    FROM us_wire_row
                    ORDER BY sort_order, id
                    """
                )
            ).mappings()
        )
        lafise_balance = self.db.execute(
            text("SELECT lafise_balance FROM settings LIMIT 1")
        ).scalar()

        # --- encabezado del tab ---
        ws["A1"] = "USA to Costa Rica Wire Transfers"
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = "Record of all the money the owners have transferred to the project."
        ws["A2"].font = NOTE_FONT

        # resumen (dos metricas del app): valores = fila TOTAL TRANSFER (fórmula viva)
        ws["A4"] = "Sent by owners"
        ws["A4"].font = LBL_FONT
        ws["C4"] = "Received at LAFISE"
        ws["C4"].font = LBL_FONT
        # A5/C5 se llenan al final (referencian la fila TOTAL)

        # --- cabecera de la tabla (mismas columnas / orden que el app) ---
        headers = [
            "Trans #", "Date", "Sender", "From", "To", "Account",
            "Sent owners", "Received LAFISE", "LAFISE Balance", "Notes",
        ]
        hr = 7
        for i, h in enumerate(headers, 1):
            c = ws.cell(hr, i, h)
            c.fill = NAVY
            c.font = WHITE
            c.alignment = Alignment(
                wrap_text=True, vertical="center", horizontal="center"
            )
        ws.row_dimensions[hr].height = 26

        # --- cuerpo: por bloque, en el orden del app ---
        r = hr + 1
        prev_saldo: str | None = None       # ref a la celda Saldo de la fila anterior
        all_data_rows: list[int] = []       # todas las filas de datos (para TOTAL)
        fila_de: dict[int, int] = {}        # id del wire -> en que fila quedo

        for key, label, note in BLOCKS:
            # banda de bloque (nombre + nota)
            for i in range(1, len(headers) + 1):
                ws.cell(r, i).fill = BLOCK_FILL
            bc = ws.cell(r, 1, label)
            bc.font = BOLD
            ws.cell(r, 2, "- " + note).font = NOTE_FONT
            ws.merge_cells(start_row=r, start_column=2,
                           end_row=r, end_column=len(headers))
            r += 1

            block_rows: list[int] = []
            for e in [x for x in rows if x["block"] == key]:
                ws.cell(r, 1, e["trans_label"])
                if e["wire_date"] is not None:
                    dc = ws.cell(r, 2, e["wire_date"])
                    dc.number_format = DATEF
                ws.cell(r, 3, e["sender"])
                ws.cell(r, 4, e["from_party"])
                ws.cell(r, 5, e["to_party"])
                ws.cell(r, 6, e["account_number"])
                # Enviado (dato base; en blanco si NULL -> el app muestra "—")
                if e["amount_sent"] is not None:
                    sc = ws.cell(r, 7, float(e["amount_sent"]))
                    sc.number_format = MONEY
                # Recibido en LAFISE (dato base editable)
                rc = ws.cell(r, 8, float(e["amount_received"] or 0))
                rc.number_format = MONEY
                rc.font = GREEN
                # El saldo se encadena despues, en el orden global: aca solo se
                # anota en que fila quedo este wire.
                fila_de[e["id"]] = r
                ws.cell(r, 10, e["notas"])
                block_rows.append(r)
                all_data_rows.append(r)
                r += 1

            # subtotal del bloque (recibido) — FÓRMULA VIVA, en la columna Recibido
            for i in range(1, len(headers) + 1):
                ws.cell(r, i).fill = SUB_FILL
            slab = ws.cell(r, 1, f"Subtotal {label} (received)")
            slab.font = BOLD
            slab.alignment = RIGHT
            ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=7)
            sub = ws.cell(
                r, 8,
                _suma(f"H{x}" for x in block_rows),
            )
            sub.number_format = MONEY
            sub.font = BOLD
            r += 1

        # ⚠️ El saldo corre en el MISMO orden que la app —`sort_order` global—,
        # no por bloque. No es lo mismo: al dar de alta un wire,
        # `create_us_wire` le pone sort_order = max + 1, asi que una fila nueva
        # de Ventanas I queda ULTIMA en el orden y PRIMERA en el dibujo.
        # Encadenando por bloque, el Excel le daria un saldo que la app no le
        # da, y toda la cadena quedaria corrida. El TOTAL no cambia (sumar no
        # depende del orden), que es lo que lo hacia invisible.
        for e in rows:
            fr = fila_de.get(e["id"])
            if fr is None:
                continue
            sal = ws.cell(
                fr, 9, f"=H{fr}" if prev_saldo is None else f"={prev_saldo}+H{fr}"
            )
            sal.number_format = MONEY
            prev_saldo = f"I{fr}"

        # --- fila TOTAL TRANSFER (enviado / recibido / saldo final) ---
        total_row = r
        for i in range(1, len(headers) + 1):
            ws.cell(r, i).fill = TOTAL
        tl = ws.cell(r, 1, "TOTAL TRANSFER")
        tl.font = BOLD
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=6)
        g = ws.cell(
            r, 7,
            _suma(f"G{x}" for x in all_data_rows),
        )
        g.number_format = MONEY
        g.font = BOLD
        h = ws.cell(
            r, 8,
            _suma(f"H{x}" for x in all_data_rows),
        )
        h.number_format = MONEY
        h.font = BOLD
        # Saldo total = ultimo saldo corrido (= total recibido). Si no hay filas, 0.
        it = ws.cell(r, 9, f"={prev_saldo}" if prev_saldo else 0)
        it.number_format = MONEY
        it.font = BOLD
        r += 1

        # --- resumen superior: referencia viva a la fila TOTAL ---
        a5 = ws.cell(5, 1, f"=G{total_row}")
        a5.number_format = MONEY
        a5.font = BOLD
        c5 = ws.cell(5, 3, f"=H{total_row}")
        c5.number_format = MONEY
        c5.font = GREEN

        # --- LAFISE Balance (dato base manual, desde settings) ---
        r += 1
        lb = ws.cell(r, 8, "LAFISE Balance")
        lb.font = BOLD
        lb.alignment = RIGHT
        val = ws.cell(
            r, 9, float(lafise_balance) if lafise_balance is not None else None
        )
        val.number_format = MONEY
        val.font = BOLD

        # ⚠️ C8 del audit: ese numero es un campo que alguien mantiene a mano en
        # `settings`. Debajo va el saldo que el estado de cuenta de LAFISE
        # reporta en la hoja Banks, por formula, y la diferencia entre los dos.
        # El control YA ESTA MARCANDO: al 2026-11-08 `settings.lafise_balance`
        # dice 49,673.41 y el estado de cuenta 48,209.76 —1,463.65 de brecha—.
        # Se deja anotado para que el comentario no desmienta al archivo.
        # ⚠️ El nombre exacto no alcanza: el resto del sistema ubica esta cuenta
        # con ILIKE '%LAFISE%operativa%' (bank_recon.resolve_account), asi que
        # puede llamarse distinto sin dejar de ser la misma. Buscandola por
        # literal, un renombre apaga este control sin que nada avise.
        fila_cierre = next(
            (
                fila
                for nombre, fila in getattr(self, "cierre_banco", {}).items()
                if "lafise" in nombre.lower() and "operativa" in nombre.lower()
            ),
            None,
        )
        if fila_cierre:
            r += 1
            e = ws.cell(r, 8, "Per Banks sheet")
            e.font = Font(size=9, color="FF808080")
            e.alignment = RIGHT
            b = ws.cell(r, 9, f"=Banks!I{fila_cierre}")
            b.number_format = MONEY
            b.font = Font(size=9, color="FF808080")
            r += 1
            e = ws.cell(r, 8, "Difference")
            e.font = Font(size=9, color="FF808080")
            e.alignment = RIGHT
            d = ws.cell(r, 9, f"=ROUND(I{r - 2}-I{r - 1},2)")
            d.number_format = MONEY
            d.font = Font(size=9, color="FF808080")
            ws.conditional_formatting.add(
                f"I{r}",
                CellIsRule(
                    operator="notEqual", formula=["0"],
                    fill=PatternFill("solid", fgColor="FFF4CCCC"),
                    font=Font(bold=True, color="FF9C0006"),
                ),
            )

        # --- anchos de columna ---
        widths = [20, 12, 16, 26, 26, 18, 16, 16, 16, 30]
        for i, w in enumerate(widths, 1):
            ws.column_dimensions[gc(i)].width = w
        ws.freeze_panes = ws.cell(hr + 1, 1)

    # ------------------------------------------------------------------ 5
    def _sheet_facturas(self) -> None:
        """Listado de facturas con sus líneas + TOTAL por fórmula (réplica de InvoicesView).

        Reproduce la vista del app: la LISTA (Nº / Proveedor / Emisión / Total) y el
        DETALLE de cada factura (líneas + Subtotal / Impuesto / Total). Modelo vivo,
        igual que services/invoice.py::_recompute:
          - Subtotal = SUM de los montos de sus líneas  (fórmula)
          - Total    = Subtotal + Impuesto              (fórmula)
        Las anuladas (status='void') quedan en el libro, marcadas ANULADA y tachadas,
        pero NO se borran ni se excluyen del listado (solo no suman al gran total).
        """
        ws = self.wb.create_sheet("Invoices")
        DATEF = "yyyy-mm-dd"
        STRIKE = Font(strike=True)
        VOIDF = Font(strike=True, color="FF999999")
        VOID_FILL = PatternFill("solid", fgColor="FFF4CCCC")

        ws["A1"] = "DASHBOARD VENTANAS — Invoices"
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = (
            "Live model. Subtotal = Σ lines · Total = Subtotal + Tax. "
            "Empty means the invoice-capture module has no entries yet — the "
            "invoices that arrived by mail are in the 'Invoice Receipts' tab."
        )
        ws["A2"].font = Font(italic=True, color="FF808080")

        cols = [
            "Invoice #", "Supplier", "Issue", "Due", "Status",
            "Description", "WBS (allocation)", "Amount",
        ]
        hr = 3
        for i, h in enumerate(cols, 1):
            c = ws.cell(hr, i, h)
            c.fill = HDR
            c.font = WHITE
        ws.row_dimensions[hr].height = 18

        # Cabeceras — orden IDÉNTICO a list_invoices (Invoice.issue_date.desc())
        invoices = self.db.execute(
            text(
                """
                SELECT i.id, i.invoice_no, i.issue_date, i.due_date,
                       i.tax, i.status, p.name AS payee
                FROM invoice i
                LEFT JOIN payee p ON p.id = i.payee_id
                ORDER BY i.issue_date DESC, i.id DESC
                """
            )
        ).mappings().all()

        # Líneas por factura (con el código WBS del reparto), en orden line_no
        lines_by_inv: dict[int, list[RowMapping]] = defaultdict(list)
        for ln in self.db.execute(
            text(
                """
                SELECT l.invoice_id, l.line_no, l.description, l.amount, w.wbs_code
                FROM invoice_line l
                LEFT JOIN wbs_item w ON w.id = l.wbs_id
                ORDER BY l.invoice_id, l.line_no
                """
            )
        ).mappings():
            lines_by_inv[ln["invoice_id"]].append(ln)

        r = hr + 1
        active_totals: list[int] = []  # filas Total de facturas NO anuladas
        for inv in invoices:
            voided = inv["status"] == "void"

            # --- fila cabecera de la factura (campos de la LISTA del app) ---
            ws.cell(r, 1, inv["invoice_no"]).font = VOIDF if voided else BOLD
            ws.cell(r, 2, inv["payee"]).font = STRIKE if voided else Font()
            ws.cell(r, 3, inv["issue_date"]).number_format = DATEF
            if inv["due_date"]:
                ws.cell(r, 4, inv["due_date"]).number_format = DATEF
            est = ws.cell(r, 5, "VOID" if voided else "Active")
            if voided:
                est.fill = VOID_FILL
                est.font = Font(bold=True, color="FF9C0006")
            else:
                for i in range(1, len(cols) + 1):
                    ws.cell(r, i).fill = SUBHDR
            r += 1

            # --- líneas (valores BASE) ---
            lines = lines_by_inv.get(inv["id"], [])
            first_line = r
            for ln in lines:
                ws.cell(r, 6, ln["description"])
                ws.cell(r, 7, (ln["wbs_code"] or "").strip() or "—")
                ws.cell(r, 8, float(ln["amount"] or 0)).number_format = MONEY
                r += 1
            last_line = r - 1

            # --- Subtotal (Σ líneas) · Impuesto (valor) · Total (fórmula) ---
            ws.cell(r, 6, "Subtotal").font = BOLD
            if lines:
                ws.cell(r, 8, f"=SUM(H{first_line}:H{last_line})").number_format = MONEY
            else:
                ws.cell(r, 8, 0).number_format = MONEY
            sub_row = r
            r += 1

            ws.cell(r, 6, "Tax").font = BOLD
            ws.cell(r, 8, float(inv["tax"] or 0)).number_format = MONEY
            tax_row = r
            r += 1

            ws.cell(r, 6, "Total").font = VOIDF if voided else BOLD
            tot = ws.cell(r, 8, f"=H{sub_row}+H{tax_row}")
            tot.number_format = MONEY
            tot.font = VOIDF if voided else BOLD
            for i in range(1, len(cols) + 1):
                ws.cell(r, i).fill = TOTAL
            if not voided:
                active_totals.append(r)
            r += 2  # una fila en blanco entre facturas

        # --- Gran total (fórmula) — solo facturas ACTIVAS; las anuladas no suman ---
        for i in range(1, len(cols) + 1):
            ws.cell(r, i).fill = HDR
            ws.cell(r, i).font = WHITE
        ws.cell(r, 6, "TOTAL ACTIVE INVOICES")
        # IN1 del audit: sin facturas activas esta celda quedaba EN BLANCO, que
        # se lee como "no se calculo" y no como "cero". _suma ya devuelve "=0".
        ws.cell(r, 8, _suma(f"H{t}" for t in active_totals)).number_format = MONEY

        for c, w in zip(range(1, 9), [16, 26, 12, 12, 12, 46, 18, 14], strict=False):
            ws.column_dimensions[gc(c)].width = w
        ws.freeze_panes = "A4"

    def _sheet_recibos(self) -> None:
        """Facturas recibidas (invoice_receipt) — las que llegan por correo.

        La hoja `Invoices` replica el modulo `invoice` del app, que hoy esta
        vacio. Las facturas que el sistema SI tiene son estas: los XML de
        Hacienda que entran al buzon. Estaban en la base y no en el libro.

        Dos cosas que esta hoja NO hace, a proposito:
          * No suma monedas distintas. Hay facturas en USD y en CRC, y las de
            CRC no traen tipo de cambio (`invoice_fx` = 1). Un total unico
            seria un numero inventado; van dos totales, uno por moneda.
          * No recalcula el Total. El total es el que declara el XML y manda
            el; lo que hace la hoja es restarle subtotal + impuesto y mostrar
            la diferencia cuando no cierra.
        """
        ws = self.wb.create_sheet("Invoice Receipts")
        DATEF = "yyyy-mm-dd"
        ROJO = PatternFill("solid", fgColor="FFF4CCCC")
        ROJO_F = Font(bold=True, color="FF9C0006")

        ws["A1"] = "DASHBOARD VENTANAS — Invoice Receipts (Hacienda XML)"
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = (
            "What arrived in the mailbox. Total is what the XML declares; "
            "Check = Subtotal + Tax − Total."
        )
        ws["A2"].font = Font(italic=True, color="FF808080")

        rows = self.db.execute(
            text(
                """
                SELECT r.received_at, r.invoice_date, r.invoice_no,
                       r.issuer_name, r.issuer_id, r.oferta, r.proyecto,
                       r.currency, r.subtotal, r.tax, r.total, r.status,
                       r.doc_type,
                       r.xml_bytes IS NOT NULL AS tiene_xml, r.has_pdf,
                       -- ⚠️ Conviven dos llaves de enlace y la vieja ya casi no se
                       -- usa: `ledger_entry_id` esta NULO en 23 de los 44 vinculos.
                       -- `sheet_row_id` los cubre los 44 y es la que lee la app
                       -- (routers/invoice_receipts.py). Yendo solo por la vieja, 23
                       -- recibos conciliados salian SIN proyecto: el dueño los veia
                       -- marcados "linked" sin saber contra que linea. Se consultan
                       -- las dos y se toma lo que responda.
                       (SELECT string_agg(DISTINCT c, ', ' ORDER BY c) FROM (
                          SELECT w.wbs_code AS c
                            FROM invoice_receipt_link l
                            JOIN ledger_entry le ON le.id = l.ledger_entry_id
                            JOIN wbs_item     w  ON w.id  = le.wbs_id
                           WHERE l.receipt_id = r.id
                          UNION
                          SELECT NULLIF(btrim(s.cost_code), '')
                            FROM invoice_receipt_link l
                            JOIN ledger_sheet_row s ON s.id = l.sheet_row_id
                           WHERE l.receipt_id = r.id
                        ) q(c) WHERE c IS NOT NULL) AS wbs
                FROM invoice_receipt r
                ORDER BY r.invoice_date DESC NULLS LAST, r.invoice_no DESC, r.id DESC
                """
            )
        ).mappings().all()

        cols = [
            ("Received", 12), ("Invoice date", 13), ("Invoice #", 22),
            ("Issuer", 40), ("Issuer ID", 14), ("Oferta", 14), ("Project", 26),
            ("Cur.", 7), ("Subtotal", 14), ("Tax", 12), ("Total", 14),
            ("Check", 12), ("Status", 10), ("WBS", 16), ("Files", 12),
        ]
        hr = 7
        for i, (h, _w) in enumerate(cols, 1):
            c = ws.cell(hr, i, h)
            c.fill = HDR
            c.font = WHITE
            c.alignment = Alignment(horizontal="center", wrap_text=True)
        ws.row_dimensions[hr].height = 24

        first = hr + 1
        r = first
        for e in rows:
            if e["received_at"]:
                ws.cell(r, 1, e["received_at"].date()).number_format = DATEF
            ws.cell(r, 2, e["invoice_date"]).number_format = DATEF
            ws.cell(r, 3, e["invoice_no"]).font = Font(name="Consolas", size=9)
            ws.cell(r, 4, e["issuer_name"])
            ws.cell(r, 5, e["issuer_id"]).font = Font(name="Consolas", size=9)
            ws.cell(r, 6, e["oferta"])
            ws.cell(r, 7, e["proyecto"])
            cu = ws.cell(r, 8, e["currency"])
            cu.alignment = Alignment(horizontal="center")
            # ⚠️ Una nota de credito RESTA. Es la misma regla que
            # routers/invoice_receipts.py::_sign y que
            # web/components/InvoiceReceipts.tsx::sgn. El export nunca leia
            # `doc_type`, asi que sumaba las 8 NC como si fueran facturas: el
            # total en colones salia ₡5,097,873.78 alto y el de dolares
            # $26,506.42. La pantalla y el libro decian cosas distintas de lo
            # mismo.
            sg = -1 if e["doc_type"] == "NC" else 1
            ws.cell(r, 9, sg * float(e["subtotal"] or 0)).number_format = MONEY
            ws.cell(r, 10, sg * float(e["tax"] or 0)).number_format = MONEY
            # El total es DATO: lo declara el XML. No se recalcula.
            ws.cell(r, 11, sg * float(e["total"] or 0)).number_format = MONEY
            ws.cell(r, 12, f"=ROUND(I{r}+J{r}-K{r},2)").number_format = MONEY
            ws.cell(r, 13, e["status"]).alignment = Alignment(horizontal="center")
            ws.cell(r, 14, e["wbs"])
            # El tipo va al final para no correr las 15 columnas de lugar:
            # sin esto, una fila en negativo no tiene explicacion a la vista.
            dt = ws.cell(r, 16, e["doc_type"])
            if e["doc_type"] == "NC":
                dt.font = Font(bold=True, color="FF9C0006")
            ws.cell(r, 15, ("XML" if e["tiene_xml"] else "")
                    + (" + PDF" if e["has_pdf"] else "")).alignment = Alignment(
                horizontal="center"
            )
            r += 1
        last = r - 1
        hay = last >= first

        if not hay:
            ws.cell(first, 1, "No invoice receipts yet.").font = Font(
                italic=True, color="FF808080"
            )
            last = first

        # Check en rojo cuando subtotal + impuesto no da el total declarado.
        ws.conditional_formatting.add(
            f"L{first}:L{last}",
            CellIsRule(operator="notEqual", formula=["0"], fill=ROJO, font=ROJO_F),
        )

        # --- Totales: UNA FILA POR MONEDA, nunca sumadas entre si ----------
        r += 1
        monedas = sorted({(e["currency"] or "?") for e in rows})
        for m in monedas:
            for i in range(1, len(cols) + 1):
                ws.cell(r, i).fill = TOTAL
            t = ws.cell(r, 4, f"TOTAL {m}")
            t.font = BOLD
            t.alignment = Alignment(horizontal="right")
            for col, L in ((9, "I"), (10, "J"), (11, "K")):
                ws.cell(
                    r, col,
                    f'=SUMIF($H${first}:$H${last},"{m}",${L}${first}:${L}${last})',
                ).number_format = MONEY
                ws.cell(r, col).font = BOLD
            # El Check tambien al pie: mientras haya XML descuadrados, la suma
            # de subtotales mas impuestos no da la de totales, y sin esta celda
            # el hueco aparece sin aviso al que sume dos columnas a mano.
            chk = ws.cell(r, 12, f"=ROUND(I{r}+J{r}-K{r},2)")
            chk.number_format = MONEY
            chk.font = BOLD
            ws.cell(
                r, 15,
                f'=COUNTIF($H${first}:$H${last},"{m}")&" inv."',
            ).alignment = Alignment(horizontal="center")
            r += 1

        # --- Resumen arriba: cuanto hay y en que estado --------------------
        kpi = [
            (1, "Receipts", f"=COUNTA($C${first}:$C${last})&\"\""),
            (3, "Linked to ledger", f'=COUNTIF($M${first}:$M${last},"linked")&""'),
            (5, "Not reviewed", f'=COUNTIF($M${first}:$M${last},"new")&""'),
            (7, "Totals not matching", f'=COUNTIF($L${first}:$L${last},"<>0")&""'),
        ]
        for col, lbl, f in kpi:
            lc = ws.cell(4, col, lbl)
            lc.font = Font(size=9, color="FF808080")
            vc = ws.cell(5, col, f)
            vc.font = Font(bold=True, size=14)

        for i, (_h, w) in enumerate(cols, 1):
            ws.column_dimensions[gc(i)].width = w
        ws.freeze_panes = f"D{first}"
        if hay:
            ws.auto_filter.ref = f"A{hr}:P{last}"

    def _sheet_legend(self) -> None:
        ws = self.wb.create_sheet("Legend")
        # Los cinco colores se pintan en una sola columna de todo el libro
        # (Dashboard, columna C). "Job Cost Report" tiene una columna que
        # tambien se llama Status y trae los mismos textos SIN relleno, asi que
        # quien lea la leyenda los busca donde no estan.
        ws["B2"] = "Status legend — these colours are painted in Dashboard, column C"
        ws["B2"].font = Font(bold=True, size=12)
        r = 4
        for code, label, hexc in STATES:
            ws.cell(r, 2).fill = PatternFill("solid", fgColor="FF" + hexc)
            ws.cell(r, 3, label).font = BOLD
            ws.cell(r, 4, code)
            r += 1
        ws["B11"] = "How to collapse"
        ws["B11"].font = Font(bold=True, size=12)
        texto = [
            "The 1 · 2 · 3 buttons at the top left of Job Cost Report:",
            "   1 → quarters only",
            "   2 → quarters + months",
            "   3 → full weekly detail",
            "The +/− above each column group also work.",
            "",
            "LIVE model: Spend, Remaining, Forecast, subtotals and totals are",
            "formulas. If you edit the LEDGER, everything recalculates on its own.",
            "",
            "WHAT IS A FORMULA AND WHAT IS DATA",
            "   Formula — anything derived: every total, every balance, every",
            "   week of Timeline and Timeline Detail, Spend, Remaining, Forecast.",
            "   Data — what the system was told: the LEDGER rows, the weekly",
            "   amounts in Job Cost Report, the bank movements, the original",
            "   budget (columns G and H). Change these and the rest follows.",
            "",
            "COLUMNS WORTH KNOWING",
            "   Job Cost Report · PLAN POST-CORTE — the schedule AFTER the cutoff",
            "      date. Forecast = Spend + this. The plan before the cutoff is",
            "      history: the LEDGER already paid it, so adding it would count",
            "      the same money twice.",
            "   Job Cost Report · PLAN vs PRESUP. — the whole schedule minus the",
            "      revised budget. Zero means the plan spends exactly the budget.",
            "   Banks · Bank reported / Difference — the balance the bank states",
            "      against the one this chain builds from debits and credits.",
            "      Red means they disagree, and the detail is what is missing.",
            "",
            "EXPENSES AND SALES DO NOT MIX",
            "   Job Cost Report and Dashboard total them on separate rows. The",
            "   sales line carries a negative sign; adding it to the expenses",
            "   understated the project budget by its own amount.",
            "",
            "INVOICE RECEIPTS",
            "   The XML invoices that arrive in the mailbox. Two totals, one per",
            "   currency: USD and CRC are never added together, and the CRC ones",
            "   carry no exchange rate, so there is no single figure to give.",
            "   Check = Subtotal + Tax − Total. Red means the XML does not add",
            "   up to what it declares; the declared Total is what counts.",
            "",
            "THE OTHER TABS",
            "   Invoices — the invoice-capture module. Empty today: it has no",
            "      entries. The invoices the system does hold are in Invoice",
            "      Receipts, the tab right next to it.",
            "   Invoice Receipts — every invoice that arrived by mail. A credit",
            "      note (Type = NC) subtracts: its row is negative on purpose.",
            "   Short Payment — the disbursement being prepared, line by line.",
            "      One month can have more than one batch (#28.0 and #28.1).",
            "   Credits — the credit account statement; empty until there is a",
            "      movement to record.",
            "   US Wire Transfers — every transfer the owners sent, against what",
            "      LAFISE received.",
            "   Timeline / Timeline Detail — the same plan at two depths:",
            "      category and WBS line. Every week in both is a formula.",
            "",
            "THE LEDGER IS AN EXCEL TABLE",
            "   Named 'Ledger'. A row typed under the last one joins the table,",
            "   and therefore every SUMIF in Job Cost Report, on its own.",
        ]
        for i, t in enumerate(texto):
            ws.cell(13 + i, 2, t)
        ws.column_dimensions["B"].width = 6
        ws.column_dimensions["C"].width = 22
        ws.column_dimensions["D"].width = 18

def build_excel(db: Session, start: dt.date | None = None, end: dt.date | None = None) -> bytes:
    lo, hi = _week_bounds(db, start, end)
    return ExcelExporter(db, lo, hi).build()
