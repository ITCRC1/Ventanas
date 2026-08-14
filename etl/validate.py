import sqlite3
con=sqlite3.connect(__import__('sys').argv[1] if len(__import__('sys').argv)>1 else 'out/ventanas.db'); con.row_factory=sqlite3.Row
q=lambda s: con.execute(s).fetchall()
print("=== 1. Totales cartera ===")
r=q("SELECT SUM(budget_original) bo,SUM(budget_change) bc,SUM(budget_revised) br,SUM(spend) sp,SUM(remaining) rm,SUM(forecast) fc FROM wbs")[0]
for k in r.keys(): print(f"  {k:4s} {r[k]:>18,.2f}")

print("\n=== 2. Integridad aritmetica por WBS ===")
print("  revised <> original+change:", q("SELECT COUNT(*) c FROM wbs WHERE ABS(IFNULL(budget_revised,0)-(IFNULL(budget_original,0)+IFNULL(budget_change,0)))>0.01")[0]['c'])
print("  remaining <> revised-spend:", q("SELECT COUNT(*) c FROM wbs WHERE ABS(IFNULL(remaining,0)-(IFNULL(budget_revised,0)-IFNULL(spend,0)))>0.01")[0]['c'])
print("  sobregiro (spend>revised) :", q("SELECT COUNT(*) c FROM wbs WHERE IFNULL(spend,0)>IFNULL(budget_revised,0)+0.01")[0]['c'])

print("\n=== 3. LEDGER vs SPEND del Job Cost Report ===")
rows=q("""SELECT w.wbs,w.task_title,w.spend, IFNULL(l.paid,0) paid, w.spend-IFNULL(l.paid,0) dif
 FROM wbs w LEFT JOIN (SELECT wbs,SUM(IFNULL(amount_paid,0)) paid FROM ledger GROUP BY wbs) l
 ON l.wbs=w.wbs WHERE ABS(IFNULL(w.spend,0)-IFNULL(l.paid,0))>0.01 ORDER BY ABS(w.spend-IFNULL(l.paid,0)) DESC LIMIT 12""")
print(f"  WBS con diferencia: {len(q('SELECT w.wbs FROM wbs w LEFT JOIN (SELECT wbs,SUM(IFNULL(amount_paid,0)) p FROM ledger GROUP BY wbs) l ON l.wbs=w.wbs WHERE ABS(IFNULL(w.spend,0)-IFNULL(l.p,0))>0.01'))}")
for x in rows: print(f"   {x['wbs']:10s} {str(x['task_title'])[:34]:36s} JCR={x['spend'] or 0:>13,.2f} LED={x['paid']:>13,.2f} dif={x['dif']:>13,.2f}")

print("\n=== 4. LEDGER huerfano (cost code sin WBS) ===")
for x in q("SELECT wbs,COUNT(*) n,SUM(IFNULL(amount_paid,0)) t FROM ledger WHERE wbs NOT IN (SELECT wbs FROM wbs) GROUP BY wbs ORDER BY t DESC LIMIT 10"):
    print(f"   {x['wbs']:12s} n={x['n']:3d} ${x['t']:,.2f}")

print("\n=== 5. Cronograma: pintado sin monto / monto sin pintar ===")
print("  semanas pintadas sin monto:", q("SELECT COUNT(*) c FROM schedule_week WHERE is_painted=1 AND IFNULL(planned_amount,0)=0")[0]['c'])
print("  semanas con monto sin color:", q("SELECT COUNT(*) c FROM schedule_week WHERE is_painted=0 AND IFNULL(planned_amount,0)<>0")[0]['c'])
print("  colores distintos usados:", q("SELECT COUNT(DISTINCT fill_rgb) c FROM schedule_week WHERE is_painted=1")[0]['c'])
for x in q("SELECT fill_rgb,COUNT(*) n FROM schedule_week WHERE is_painted=1 GROUP BY fill_rgb ORDER BY n DESC LIMIT 8"):
    print(f"     {x['fill_rgb']} {x['n']}")

print("\n=== 6. Higiene de catalogos (espacios / duplicados) ===")
for col in ['category','phase','task_owner','status']:
    vals=[r[0] for r in q(f"SELECT DISTINCT {col} FROM wbs WHERE {col} IS NOT NULL")]
    dups=[v for v in vals if v!=v.strip() or (v.strip() in [x.strip() for x in vals if x!=v])]
    print(f"  {col:11s} {len(vals):3d} valores | colisiones por espacios/case: {sorted(set(dups))[:6]}")

print("\n=== 7. Bancos ===")
for x in q("SELECT account,COUNT(*) n,SUM(IFNULL(credit,0)) cr,SUM(IFNULL(debit,0)) db FROM bank_tx GROUP BY account"):
    print(f"  {x['account']:8s} n={x['n']:4d} creditos={x['cr']:>15,.2f} debitos={x['db']:>15,.2f}")
print("  wires USA->CR:", q("SELECT SUM(amount) s FROM wire")[0]['s'])
