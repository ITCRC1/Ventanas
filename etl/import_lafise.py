#!/usr/bin/env python3
"""
DASHBOARD VENTANAS — Importador de estado de cuenta LAFISE

Lee el .xls que se baja de la banca en línea de LAFISE y lo carga a bank_tx.
Clasifica cada movimiento contra bank_classification_rule, es idempotente
(reimportar el mismo período no duplica) y reporta cargos por mes.

Uso:
    python import_lafise.py MovimientosDeCuenta_LAFISE_VENTANAS.xls
    python import_lafise.py archivo.xls --dry-run
"""
import argparse, os, re, sys, hashlib, datetime as dt
from collections import defaultdict

try:
    import xlrd
except ImportError:
    sys.exit("Falta xlrd: pip install xlrd")

MESES = {'ENE': 1, 'FEB': 2, 'MAR': 3, 'ABR': 4, 'MAY': 5, 'JUN': 6,
         'JUL': 7, 'AGO': 8, 'SET': 9, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DIC': 12}

# Reglas espejo de bank_classification_rule, para el modo --dry-run sin base
REGLAS = [
    (r'^INTERESES',           'interest',       'credit'),
    (r'^COMISI',              'transfer_fee',   'debit'),
    (r'CARGO ADMINISTRATIVO', 'admin_charge',   'debit'),
    (r'PV2 DEPLOYMENT',       'escrow_funding', 'credit'),
]


def parse_fecha(txt):
    d, m, y = txt.strip().split('/')
    return dt.date(int(y), MESES[m.upper()], int(d))


def num(v):
    v = str(v).strip().replace(',', '')
    if not v:
        return 0.0
    try:
        return float(v)
    except ValueError:
        return 0.0


def clasificar(desc, debe, haber):
    up = (desc or '').upper()
    for pat, code, side in REGLAS:
        if re.search(pat, up):
            if side == 'debit' and debe <= 0:
                continue
            if side == 'credit' and haber <= 0:
                continue
            return code
    return 'payment' if debe > 0 else 'other'


def leer(path):
    """Devuelve (metadatos, movimientos). Tolera que el banco mueva las filas."""
    sh = xlrd.open_workbook(path).sheet_by_index(0)
    meta, hdr = {}, None
    for r in range(min(sh.nrows, 40)):
        fila = [str(sh.cell_value(r, c)).strip() for c in range(sh.ncols)]
        txt = [x for x in fila if x]
        if len(txt) >= 2:
            k = txt[0].lower()
            if 'nro. de cuenta' in k:  meta['iban']    = txt[1]
            elif k.startswith('cliente'): meta['cliente'] = txt[1]
            elif k.startswith('moneda'):  meta['moneda']  = txt[1]
            elif k.startswith('banco'):   meta['banco']   = txt[1]
            elif k.startswith('desde'):
                meta['desde'] = txt[1]
                if len(txt) >= 4: meta['hasta'] = txt[3]
        if 'Fecha' in fila and 'Descripción' in fila:
            hdr = {name: i for i, name in enumerate(fila) if name}
    if hdr is None:
        raise SystemExit("No encontré la fila de encabezados (Fecha / Descripción).")

    col = lambda n: hdr.get(n)
    movs = []
    empezo = False
    for r in range(sh.nrows):
        f = str(sh.cell_value(r, col('Fecha'))).strip()
        if not empezo:
            empezo = bool(re.match(r'\d{2}/[A-Za-z]{3}/\d{4}', f))
            if not empezo:
                continue
        if not re.match(r'\d{2}/[A-Za-z]{3}/\d{4}', f):
            continue
        desc  = str(sh.cell_value(r, col('Descripción'))).strip()
        debe  = num(sh.cell_value(r, col('Débito')))
        haber = num(sh.cell_value(r, col('Crédito')))
        movs.append(dict(
            fecha  = parse_fecha(f),
            txn_no = str(sh.cell_value(r, col('Número de confirmación'))).strip(),
            desc   = desc,
            debito = debe or None,
            credito= haber or None,
            saldo  = num(sh.cell_value(r, col('Saldo'))),
            clase  = clasificar(desc, debe, haber),
            fila   = r,
        ))
    # El archivo viene del más reciente al más antiguo. El orden REAL de
    # asiento es el del archivo invertido: dentro de un mismo día el número
    # de confirmación no refleja la secuencia.
    movs.reverse()
    return meta, movs


def verificar_saldos(movs):
    """El saldo de cada línea debe ser el anterior +crédito −débito."""
    fallos = []
    for i in range(1, len(movs)):
        prev, cur = movs[i-1], movs[i]
        esperado = prev['saldo'] + (cur['credito'] or 0) - (cur['debito'] or 0)
        if abs(esperado - cur['saldo']) > 0.005:
            fallos.append((cur['fecha'], cur['desc'][:30], esperado, cur['saldo']))
    return fallos


def resumen(movs):
    por_mes = defaultdict(lambda: defaultdict(float))
    cuenta  = defaultdict(lambda: defaultdict(int))
    for m in movs:
        k = m['fecha'].strftime('%Y-%m')
        por_mes[k][m['clase']] += (m['debito'] or 0) + (m['credito'] or 0)
        cuenta[k][m['clase']] += 1
    return por_mes, cuenta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('archivo')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--account', default='Ventanas LAFISE (operativa)')
    ap.add_argument('--pg', default=os.environ.get('DATABASE_URL',
                                                   'postgresql:///dashboard_ventanas'))
    a = ap.parse_args()

    meta, movs = leer(a.archivo)
    lote = hashlib.sha1(
        (os.path.basename(a.archivo) + str(len(movs)) + str(movs[-1]['saldo'])
         ).encode()).hexdigest()[:12]

    print(f"Cuenta   : {meta.get('cliente','?')}")
    print(f"IBAN     : {meta.get('iban','?')}   {meta.get('moneda','')}")
    print(f"Período  : {meta.get('desde','?')} a {meta.get('hasta','?')}")
    print(f"Lote     : {lote}")
    print(f"Movimientos: {len(movs)}   saldo final: {movs[-1]['saldo']:,.2f}\n")

    fallos = verificar_saldos(movs)
    if fallos:
        print(f"AVISO: {len(fallos)} líneas donde el saldo no encadena:")
        for f in fallos[:5]:
            print(f"   {f[0]} {f[1]:32s} esperado={f[2]:,.2f} archivo={f[3]:,.2f}")
    else:
        print("Verificación de saldos: encadenan correctamente.\n")

    por_mes, cuenta = resumen(movs)
    print("=== CARGOS DE CUENTA POR MES ===")
    print(f"{'Mes':9s} {'Com.transf':>12s} {'#':>3s} {'Cargo adm':>11s} "
          f"{'Cargos':>10s} {'Intereses':>11s} {'Neto':>10s}")
    tc = ta = ti = 0.0
    for k in sorted(por_mes):
        c  = por_mes[k].get('transfer_fee', 0)
        ad = por_mes[k].get('admin_charge', 0)
        i  = por_mes[k].get('interest', 0)
        tc, ta, ti = tc + c, ta + ad, ti + i
        print(f"{k:9s} {c:>12,.2f} {cuenta[k].get('transfer_fee',0):>3d} "
              f"{ad:>11,.2f} {c+ad:>10,.2f} {i:>11,.2f} {i-c-ad:>10,.2f}")
    print(f"{'TOTAL':9s} {tc:>12,.2f} {'':>3s} {ta:>11,.2f} {tc+ta:>10,.2f} "
          f"{ti:>11,.2f} {ti-tc-ta:>10,.2f}")

    fondeos = [m for m in movs if m['clase'] == 'escrow_funding']
    if fondeos:
        print("\n=== FONDEOS DESDE ESCROW ===")
        for m in fondeos:
            print(f"   {m['fecha']}  {m['desc'][:38]:40s} {m['credito']:>12,.2f}")
        print(f"   {'TOTAL':>52s} {sum(m['credito'] for m in fondeos):>12,.2f}")

    sinclas = [m for m in movs if m['clase'] == 'other']
    if sinclas:
        print(f"\n=== {len(sinclas)} SIN CLASIFICAR (revisar) ===")
        for m in sinclas[:10]:
            print(f"   {m['fecha']}  {m['desc'][:44]}")

    if a.dry_run:
        print("\n(dry-run: no se escribió nada)")
        return

    import psycopg
    with psycopg.connect(a.pg) as cx:
        with cx.cursor() as cur:
            cur.execute("SELECT set_config('app.user_id', 'import-lafise', false)")
            cur.execute("SELECT id FROM bank_account WHERE name=%s", (a.account,))
            row = cur.fetchone()
            if not row:
                sys.exit(f"No existe la cuenta '{a.account}' en bank_account.")
            acc = row[0]
            nuevos = 0
            for m in movs:
                cur.execute("""
                    INSERT INTO bank_tx (account_id,tx_date,txn_no,description,
                                         debit,credit,balance,class_code,import_batch)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (account_id,tx_date,txn_no,description,debit,credit)
                    DO NOTHING""",
                    (acc, m['fecha'], m['txn_no'], m['desc'], m['debito'],
                     m['credito'], m['saldo'], m['clase'], lote))
                nuevos += cur.rowcount
        cx.commit()
    print(f"\nImportados {nuevos} movimientos nuevos "
          f"({len(movs)-nuevos} ya estaban).")


if __name__ == '__main__':
    main()
