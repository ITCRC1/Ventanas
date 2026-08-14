#!/usr/bin/env python3
"""
DASHBOARD VENTANAS — carga inicial Excel -> PostgreSQL

Cierra el hueco entre extract.py (SQLite) y schema_v2.sql (Postgres).

Uso:
    python extract.py                       # produce out/ventanas.db
    psql $DATABASE_URL -f schema_v2.sql     # crea el esquema
    python load.py --dry-run                # valida sin escribir
    python load.py                          # carga
    python load.py --reconcile              # compara Postgres vs Excel

Mapeo de tablas:
    SQLite            ->  PostgreSQL
    wbs               ->  wbs_item + budget_version/budget_line
    ledger            ->  ledger_entry
    schedule_week     ->  schedule_cell     (fill_rgb -> task_state)
    bank_tx           ->  bank_account + bank_tx
    wire              ->  wire_transfer
    change_log        ->  audit_log
"""
import argparse, os, re, sqlite3, sys, datetime as dt
from decimal import Decimal

try:
    import psycopg
except ImportError:
    sys.exit("Falta psycopg: pip install 'psycopg[binary]'")

SQLITE = os.environ.get('VENTANAS_SQLITE', 'out/ventanas.db')
PGURL  = os.environ.get('DATABASE_URL', 'postgresql:///dashboard_ventanas')
LOAD_USER = os.environ.get('VENTANAS_LOAD_USER', 'carga-inicial')

# Leyenda del master (Job Cost Report, filas 129-133)
COLOR_STATE = {
    'FFCCCCCC': 'not_started',
    'FFFFFF00': 'in_process',
    'FF1155CC': 'approved',
    'FFB85B22': 'attention',
    'FF38761D': 'completed',
}
# Rellenos de encabezado/total: no son estado de cronograma
IGNORE_FILL = {'FFC8DCF0', 'FFA2C4C9', 'FFFFF5B4', 'FFFFFFFF', '00000000', None}


def monday(d):
    """Normaliza cualquier fecha al lunes de su semana ISO."""
    return d - dt.timedelta(days=d.weekday())


def dec(x):
    return None if x is None else Decimal(str(round(float(x), 2)))


class Loader:
    def __init__(self, sq, pg, dry):
        self.sq, self.pg, self.dry = sq, pg, dry
        self.stats, self.warn = {}, []
        self.monto_sinfecha = 0.0

    def q(self, sql, *a):
        cur = self.sq.execute(sql, a)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]

    def x(self, sql, params=None):
        if self.dry:
            return None
        with self.pg.cursor() as c:
            c.execute(sql, params or ())
            try:
                return c.fetchone()
            except psycopg.ProgrammingError:
                return None

    # ---------------------------------------------------------------- 1
    def catalogs(self):
        """Categorías y fases desde los valores distintos del master."""
        cats = {r['category'] for r in self.q(
            "SELECT DISTINCT TRIM(category) category FROM wbs WHERE category IS NOT NULL")}
        for i, name in enumerate(sorted(c for c in cats if c), 1):
            self.x("INSERT INTO category (code,name,sort_order) VALUES (%s,%s,%s) "
                   "ON CONFLICT (code) DO NOTHING", (name, name, i))
        pairs = self.q("""SELECT DISTINCT TRIM(category) c, TRIM(phase) p FROM wbs
                          WHERE category IS NOT NULL AND phase IS NOT NULL""")
        for i, r in enumerate(sorted(pairs, key=lambda z: (z['c'] or '', z['p'] or '')), 1):
            self.x("""INSERT INTO phase (category_id,code,name,sort_order)
                      SELECT id,%s,%s,%s FROM category WHERE code=%s
                      ON CONFLICT (category_id,code) DO NOTHING""",
                   (r['p'], r['p'], i, r['c']))
        self.stats['category'] = len(cats)
        self.stats['phase'] = len(pairs)

    # ---------------------------------------------------------------- 2
    def wbs(self):
        rows = self.q("SELECT * FROM wbs ORDER BY src_row")
        self.x("""INSERT INTO budget_version (version_no,effective_date,note)
                  VALUES (1,%s,'Presupuesto original (carga inicial)'),
                         (2,%s,'Cambios acumulados (carga inicial)')
                  ON CONFLICT (version_no) DO NOTHING""",
               (dt.date.today(), dt.date.today()))
        state_map = {'Approved': 'approved', 'In process': 'in_process',
                     'Attention': 'attention', 'Completed': 'completed'}
        n = 0
        for r in rows:
            code = (r['wbs'] or '').strip()
            if not code:
                continue
            title = (r['task_title'] or '').strip()
            cat = (r['category'] or '').strip() or None
            ph = (r['phase'] or '').strip() or None
            # Encabezado de sección: sin categoría, sin fase y sin monto
            is_hdr = not cat and not ph and not r['budget_revised']
            # Línea negativa que corresponde a venta, no a costo
            kind = 'section_header' if is_hdr else (
                'proceeds' if (r['budget_revised'] or 0) < 0 else 'cost')
            st = state_map.get((r['status'] or '').strip(), 'not_started')
            self.x("""INSERT INTO wbs_item
                      (wbs_code,title,owner,category_id,phase_id,state_id,kind,sort_order)
                      VALUES (%s,%s,%s,
                        (SELECT id FROM category WHERE code=%s),
                        (SELECT p.id FROM phase p JOIN category c ON c.id=p.category_id
                          WHERE p.code=%s AND c.code=%s),
                        (SELECT id FROM task_state WHERE code=%s),%s,%s)
                      ON CONFLICT (wbs_code) DO NOTHING""",
                   (code, title or code, (r['task_owner'] or '').strip() or None,
                    cat, ph, cat, st, kind, r['src_row']))
            for vno, amt in ((1, r['budget_original']), (2, r['budget_change'])):
                if amt:
                    self.x("""INSERT INTO budget_line (wbs_id,version_id,amount)
                              SELECT w.id, v.id, %s FROM wbs_item w, budget_version v
                              WHERE w.wbs_code=%s AND v.version_no=%s
                              ON CONFLICT (wbs_id,version_id) DO UPDATE SET amount=EXCLUDED.amount""",
                           (dec(amt), code, vno))
            n += 1
        self.stats['wbs_item'] = n

    # ---------------------------------------------------------------- 3
    def ledger(self):
        n = orphan = sinfecha = recuperados = 0
        monto_sinfecha = 0.0
        excepciones = set()
        comprometidos = 0
        for r in self.q("SELECT * FROM ledger ORDER BY src_row"):
            code = (r['wbs'] or '').strip()
            # Un libro contable no admite asientos sin fecha, y no se inventan:
            # se reportan para corregir en el origen y quedan fuera de la carga.
            disb_no, fecha_txt, fmt = self._disb_ref(r['payee'], r['description'])
            if fmt and 'excepción' in fmt and disb_no not in excepciones:
                excepciones.add(disb_no)
                self.warn.append(
                    f"Desembolso #{disb_no}: fecha escrita al revés (DD/MM) "
                    f"cuando el resto del LEDGER usa MM/DD -> {fecha_txt}")
            fecha = r['date'] or (fecha_txt.isoformat() if fecha_txt else None)
            pagado = float(r['amount_paid'] or 0)
            if not fecha and pagado > 0:
                # Hubo pago pero no hay fecha: eso sí bloquea.
                sinfecha += 1
                monto_sinfecha += pagado
                self.warn.append(
                    f"LEDGER fila {r['src_row']}: PAGO SIN FECHA — "
                    f"'{(r['account'] or r['description'] or '')[:38]}' "
                    f"${pagado:,.2f}")
                continue
            if not fecha:
                # Compromiso no pagado: entra como 'pending', sin fecha.
                comprometidos += 1
            if disb_no is not None:
                recuperados += 1
            got = self.x("SELECT id FROM wbs_item WHERE wbs_code=%s", (code,))
            if not got and not self.dry:
                orphan += 1
                self.warn.append(f"LEDGER fila {r['src_row']}: cost code '{code}' sin WBS")
            self.x("""INSERT INTO ledger_entry
                      (wbs_id,entry_date,invoice_no,description,currency,amount,
                       fx_rate,amount_paid,funding_source,status)
                      VALUES ((SELECT id FROM wbs_item WHERE wbs_code=%s),
                              %s,%s,%s,'USD',%s,1,%s,%s,
                              CASE WHEN %s >= %s THEN 'paid'
                                   WHEN %s > 0    THEN 'partial'
                                   ELSE 'pending' END)""",
                   (code, fecha, r['invoice'], r['description'],
                    dec(r['amount']) or 0, dec(r['amount_paid']) or 0, r['funding_source'],
                    dec(r['amount_paid']) or 0, dec(r['amount']) or 0,
                    dec(r['amount_paid']) or 0))
            n += 1
        self.stats['ledger_entry'] = n
        if recuperados:
            self.stats['fechas_recuperadas_del_texto'] = recuperados
        if orphan:
            self.stats['ledger_huerfanos'] = orphan
        if comprometidos:
            self.stats['compromisos_sin_pagar'] = comprometidos
        if sinfecha:
            self.stats['PAGOS_SIN_FECHA'] = sinfecha
            self.monto_sinfecha = monto_sinfecha

    # ---------------------------------------------------------------- 4
    def schedule(self):
        n = skipped = 0
        for r in self.q("SELECT * FROM schedule_week"):
            rgb = r['fill_rgb']
            if rgb in IGNORE_FILL and not r['planned_amount']:
                continue
            state = COLOR_STATE.get(rgb)
            if state is None:
                state = 'in_process' if r['planned_amount'] else None
                if state is None:
                    skipped += 1
                    continue
            amt = dec(r['planned_amount'])
            # el estado exige monto: si falta, degrada a not_started
            if state != 'not_started' and amt is None:
                state = 'not_started'
            wk = monday(dt.date.fromisoformat(r['week_start']))
            self.x("""INSERT INTO schedule_cell (wbs_id,week_start,planned_amount,state_id)
                      SELECT w.id,%s,%s,ts.id FROM wbs_item w, task_state ts
                      WHERE w.wbs_code=%s AND ts.code=%s
                      ON CONFLICT (wbs_id,week_start) DO UPDATE
                        SET planned_amount=EXCLUDED.planned_amount, state_id=EXCLUDED.state_id""",
                   (wk, amt, (r['wbs'] or '').strip(), state))
            n += 1
        self.stats['schedule_cell'] = n
        if skipped:
            self.stats['celdas_ignoradas'] = skipped

    # ---------------------------------------------------------------- 5
    def banks(self):
        roles = {'PV1': ('Playa Ventanas I', 'source'),
                 'PV2': ('Playa Ventanas II (Escrow)', 'escrow'),
                 'PV2-alt': ('Playa Ventanas II (parcial)', 'escrow'),
                 'LAFISE': ('Ventanas LAFISE (operativa)', 'operating')}
        for acc, (name, role) in roles.items():
            self.x("INSERT INTO bank_account (name,role) VALUES (%s,%s) "
                   "ON CONFLICT (name) DO NOTHING", (name, role))
        n = 0
        for r in self.q("SELECT * FROM bank_tx ORDER BY id"):
            name = roles.get(r['account'], (r['account'], 'operating'))[0]
            # Las hojas bancarias del Excel no traen número de confirmación.
            # Se usa la fila de origen como identificador para no perder
            # movimientos repetidos (p. ej. dos comisiones de $4 el mismo día).
            txn = r['txn_no'] or f"XLS-{r['src_sheet']}-{r['src_row']}"
            self.x("""INSERT INTO bank_tx
                      (account_id,tx_date,txn_no,description,debit,credit,balance,import_batch)
                      SELECT id,%s,%s,%s,%s,%s,%s,'excel-legacy' FROM bank_account WHERE name=%s
                      ON CONFLICT DO NOTHING""",
                   (r['date'], txn, r['description'], dec(r['debit']),
                    dec(r['credit']), dec(r['balance']), name))
            n += 1
        self.stats['bank_tx'] = n
        w = 0
        for r in self.q("SELECT * FROM wire"):
            # El Excel registra el NETO que entró. El bruto enviado no existe
            # en el archivo: se carga igual al neto y queda marcado como
            # pendiente de conciliar en v_wire_pending.
            neto = dec(r['amount'])
            self.x("""INSERT INTO wire_transfer
                      (wire_date,sender,to_account_id,amount_sent,amount_received,note)
                      SELECT %s,%s,id,%s,%s,%s FROM bank_account
                       WHERE role='escrow' LIMIT 1""",
                   (r['date'], r['sender'] or 'Hovde Master LLC', neto, neto,
                    (r['note'] or '') + ' [bruto enviado sin registrar en el Excel]'))
            w += 1
        self.stats['wire_transfer'] = w
        self.warn.append("Wires cargados con amount_sent = amount_received: el Excel "
                         "sólo guarda el NETO. El bruto y la comisión hay que "
                         "capturarlos aparte (ver v_wire_pending).")
        self.warn.append("Los wires quedan SIN disbursement_id: hay que ligarlos a mano "
                         "(en el Excel el control se quedó atrás respecto al LEDGER).")

    # ---------------------------------------------------------------- 6
    # La columna Date del LEDGER está vacía en las 237 filas. La fecha y el
    # número de desembolso viven dentro del texto del Payee, con la forma
    # "Disbursement #21 - 03/01/2026". De ahí se recuperan.
    RE_DISB = re.compile(r'Disbursement\s*#?\s*(\d+)\s*[-\u2013]?\s*'
                         r'(?:(\d{2})/(\d{2})/(\d{4}))?', re.I)

    @classmethod
    def _disb_ref(cls, *textos):
        """(numero_desembolso, fecha, formato) desde el texto libre.

        El LEDGER escribe las fechas en formato ESTADOUNIDENSE MM/DD/YYYY.
        Queda demostrado por la progresión #19..#26 = 01/01 .. 08/01/2026,
        que son los meses de enero a agosto, y por #04 = 10/18/2024 y
        #06 = 01/13/2025, imposibles como DD/MM.

        Hay excepciones escritas al revés (p. ej. #05 = 16/12/2024). Se
        detectan porque el primer campo sería un mes > 12, y se marcan.
        """
        for t in textos:
            m = cls.RE_DISB.search(str(t or ''))
            if not m:
                continue
            no = int(m.group(1))
            if not m.group(2):
                return no, None, None
            a, b, yy = int(m.group(2)), int(m.group(3)), int(m.group(4))
            if a > 12 and b <= 12:          # sólo puede ser DD/MM
                try:
                    return no, dt.date(yy, b, a), 'DD/MM (excepción)'
                except ValueError:
                    return no, None, None
            try:                            # formato dominante MM/DD
                return no, dt.date(yy, a, b), 'MM/DD'
            except ValueError:
                try:
                    return no, dt.date(yy, b, a), 'DD/MM (fallback)'
                except ValueError:
                    return no, None, None
        # Último recurso: una fecha suelta en el texto (p. ej. "Helicopter
        # Wire - 25/7/2024"). Se acepta sólo si es inequívoca.
        for t in textos:
            m = re.search(r'\b(\d{1,2})/(\d{1,2})/(\d{4})\b', str(t or ''))
            if not m:
                continue
            a, b, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if a > 12 and b <= 12:
                try:
                    return None, dt.date(yy, b, a), 'DD/MM (texto libre)'
                except ValueError:
                    pass
            elif b > 12 and a <= 12:
                try:
                    return None, dt.date(yy, a, b), 'MM/DD (texto libre)'
                except ValueError:
                    pass
        return None, None, None

    @staticmethod
    def _ts(v):
        """El LOG de Cambios guarda 'DD-MM-YYYY HH:MM:SS' (formato CR)."""
        if not v:
            return None
        v = str(v).strip()
        for fmt in ('%d-%m-%Y %H:%M:%S', '%d/%m/%Y %H:%M:%S',
                    '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S'):
            try:
                return dt.datetime.strptime(v, fmt)
            except ValueError:
                continue
        return None

    def changelog(self):
        n = malformadas = 0
        for r in self.q("SELECT * FROM change_log"):
            ts = self._ts(r['ts'])
            if ts is None:
                malformadas += 1
                continue
            self.x("""INSERT INTO audit_log (table_name,record_id,field,old_value,new_value,user_id,changed_at)
                      VALUES ('wbs_item',0,'status',%s,%s,%s,%s)""",
                   (r['old_value'], r['new_value'], 'LOG de Cambios (Excel)', ts))
            n += 1
        self.stats['audit_log'] = n
        if malformadas:
            self.stats['audit_fecha_ilegible'] = malformadas

    # ---------------------------------------------------------------- 7
    def reconcile(self):
        print("\n=== CONCILIACIÓN Postgres vs Excel ===")
        ex = self.q("""SELECT SUM(budget_revised) br, SUM(spend) sp, COUNT(*) n FROM wbs""")[0]
        if self.dry:
            print("  (dry-run: sin comparar contra Postgres)")
            return
        pg = self.x("SELECT SUM(budget_revised), SUM(spend), COUNT(*) FROM v_wbs_financials")
        rows = [("líneas WBS", ex['n'], pg[2]),
                ("presupuesto revisado", ex['br'], float(pg[0] or 0)),
                ("gasto", ex['sp'], float(pg[1] or 0))]
        if self.monto_sinfecha:
            print(f"  NOTA: ${self.monto_sinfecha:,.2f} en asientos SIN FECHA quedaron "
                  f"fuera; explican parte de la diferencia de gasto.")
        ok = True
        for label, a, b in rows:
            d = float(a or 0) - float(b or 0)
            flag = "OK " if abs(d) < 0.01 else "DIF"
            ok &= abs(d) < 0.01
            print(f"  [{flag}] {label:24s} excel={float(a or 0):>16,.2f}  pg={float(b or 0):>16,.2f}  dif={d:>12,.2f}")
        print("  => CUADRA" if ok else "  => NO CUADRA: revisar antes de seguir")

    def run(self, reconcile):
        for step in (self.catalogs, self.wbs, self.ledger,
                     self.schedule, self.banks, self.changelog):
            step()
            print(f"  ✓ {step.__name__}")
        print("\n=== RESUMEN ===")
        for k, v in self.stats.items():
            print(f"  {k:22s} {v:>8}")
        if self.warn:
            print("\n=== AVISOS ===")
            for w in self.warn[:20]:
                print("  !", w)
            if len(self.warn) > 20:
                print(f"  ... y {len(self.warn)-20} más")
        if reconcile:
            self.reconcile()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='valida sin escribir')
    ap.add_argument('--reconcile', action='store_true', help='compara al final')
    ap.add_argument('--sqlite', default=SQLITE)
    ap.add_argument('--pg', default=PGURL)
    a = ap.parse_args()

    sq = sqlite3.connect(a.sqlite)
    pg = None if a.dry_run else psycopg.connect(a.pg)
    if pg:
        with pg.cursor() as c:
            c.execute("SELECT set_config('app.user_id', %s, false)", (LOAD_USER,))
    print(f"SQLite: {a.sqlite}\nPostgres: {'(dry-run)' if a.dry_run else a.pg}\n")
    try:
        Loader(sq, pg, a.dry_run).run(a.reconcile)
        if pg:
            pg.commit()
            print("\nCommit OK.")
    except Exception:
        if pg:
            pg.rollback()
            print("\nRollback: no se escribió nada.")
        raise
    finally:
        sq.close()
        if pg:
            pg.close()


if __name__ == '__main__':
    main()
