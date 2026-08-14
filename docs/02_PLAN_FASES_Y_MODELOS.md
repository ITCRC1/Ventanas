# DASHBOARD VENTANAS — Plan por fases y asignación de modelo

> Documento de ejecución. Complementa `VENTANAS_MAPA_Y_PLAN_APP.md` (el análisis)
> y `schema_v2.sql` (el modelo, validado con 63 pruebas contra PostgreSQL 16.14).

---

## 1. Stack — decisiones y por qué

| Capa | Decisión | Razón |
|---|---|---|
| Base de datos | **PostgreSQL 16+** | Ya validado. Columnas generadas, `CONSTRAINT TRIGGER` diferido, window functions y `jsonb` — todo lo que el modelo usa |
| Backend | **FastAPI + SQLAlchemy 2.0 + Alembic** | Tu stack. Alembic desde el día 1: sin migraciones versionadas, un esquema financiero se vuelve inmanejable |
| Front | **Next.js 15 (App Router) + TypeScript + TanStack Query** | Tu stack. TanStack Table para la grilla del Job Cost |
| Grilla | **TanStack Table + virtualización** | 200 WBS × 260 semanas = 52.000 celdas. Sin virtualización el navegador muere |
| Gantt | **Componente propio sobre canvas o CSS grid** | Las librerías de Gantt asumen tareas con fecha inicio/fin. Acá el cronograma es monto por semana con estado — es otro modelo |
| Export Excel | **openpyxl** | Ya probado: genera fórmulas vivas y agrupación real de 3 niveles |
| PDF | **WeasyPrint** (HTML→PDF) | La instrucción de transferencia es un documento de formato fijo; HTML+CSS es más mantenible que ReportLab |
| Auth | **OIDC** (Microsoft 365, que ya usás) o Authlib | Nunca contraseñas propias. Menos superficie de ataque |
| Hosting | A definir | Ver sección 4 |

### Lo que NO recomiendo

- **Nada de ORM para las vistas de reporte.** `v_timeline`, `v_credit_ledger` y compañía se consultan con SQL crudo. El ORM ahí sólo agrega latencia y opacidad.
- **Nada de lógica de negocio en el front.** Los totales, saldos y validaciones ya viven en triggers y vistas. Si el front recalcula, tarde o temprano difiere — que es exactamente lo que pasa hoy en el Excel.
- **Nada de soft-delete generalizado.** Para datos financieros, anular con estado (`cancelled`) y auditoría. Ya está modelado.

---

## 2. Fases

Cada fase termina en algo que podés ver y aprobar. Ninguna depende de la siguiente para tener valor.

| # | Fase | Entregable | Depende de | Modelo | Esfuerzo |
|---|---|---|---|---|---|
| 0 | Análisis y mapeo | ✅ hecho | — | Opus | — |
| 1 | Modelo de datos + validación | ✅ hecho (63 pruebas) | 0 | Opus | — |
| 2 | **Carga y conciliación** | `load.py` corriendo contra el archivo vigente; reporte de conciliación línea por línea | 1 | **Sonnet** | 1-2 d |
| 3 | **Migraciones + API base** | Alembic; CRUD de WBS, categorías, fases, ledger; auth OIDC; permisos por rol | 2 | **Sonnet** | 4-6 d |
| 4 | **Grilla Job Cost Report** | La pantalla del día a día: editar WBS, reasignar categoría/fase, ver presupuesto vs actual | 3 | **Opus** | 5-7 d |
| 5 | **Cronograma (Gantt)** | Grilla semanal con estados y colores, colapso semana/mes/trimestre, edición de monto en celda | 4 | **Opus / Fable** | 7-10 d |
| 6 | **Short Payment + PDF** | Armar el desembolso del mes con recurrentes precargados; generar Breakdown e Instrucción | 3 | **Opus** | 5-7 d |
| 7 | **Cuenta de créditos** | Estado de cuenta con saldo corrido; aplicar total/parcial/nada | 6 | **Sonnet** | 2-3 d |
| 8 | **Export Excel vivo** | ✅ prototipo funcionando; falta conectarlo a la API y agregar Timeline | 4, 5 | **Opus** | 3-4 d |
| 9 | **Bancos, wires y comisiones** | Importar estado LAFISE; matchear contra ledger; wire bruto/comisión/neto; trazabilidad completa | 3 | **Sonnet** | 5-6 d |
| 10 | **Facturas** | Captura con detalle por línea, PDF adjunto, reparto entre WBS | 9 | **Sonnet** | 3-4 d |
| 11 | **Endurecimiento** | Backups, PITR, cifrado en reposo, rate limiting, pruebas de carga | 3-10 | **Opus** | 3-4 d |
| — | Mantenimiento continuo | Tests, refactors chicos, correcciones de copy | — | **Haiku** | — |

**Camino mínimo para reemplazar el Excel:** fases 2 → 3 → 4 → 5 → 8. Con eso ya podés dejar de abrir el `.xlsm`.

---

## 3. Qué modelo usar en cada fase, y por qué

La regla no es "el más caro siempre". Es: **¿el costo de una decisión equivocada acá es alto o bajo?**

### Fable 5 / tier Mythos — donde la capacidad extra se paga sola
- **Fase 5, el Gantt.** Es la pieza con más riesgo: interacción compleja, 52.000 celdas virtualizadas, edición en celda, colapso de tres niveles, y estados que disparan validación en el servidor. Si el modelo de interacción sale mal, se rehace entero.
- **Cualquier refactor grande** que toque varias capas a la vez.
- *Advertencia:* Fable tiene enrutamiento de seguridad — algunas consultas se responden con Opus 4.8. Para este trabajo no debería activarse, pero si notás un cambio de tono a mitad de sesión, es eso.

### Opus 4.8 — el caballo de batalla del trabajo de diseño
- **Fase 4 (grilla)** y **fase 6 (short payment + PDF)**: son las pantallas donde vive tu día a día y donde un mal modelo de datos en el front se paga durante años.
- **Fase 8 (export Excel)**: fórmulas encadenadas, `outlineLevel` por columna, formato condicional. Es intrincado y falla en silencio — el bug de agrupación de este prototipo apareció sólo al inspeccionar el XML generado.
- **Fase 11 (seguridad)**: acá un error no se ve hasta que duele.

### Sonnet 5 — trabajo bien especificado
- **Fases 2, 3, 7, 9, 10.** El esquema ya está definido y validado; el trabajo es implementar contra un contrato claro. CRUD, importadores, conciliación por matching. Sonnet lo hace bien y rápido.

### Haiku 4.5 — mecánico y de alto volumen
- Generar tests a partir de casos existentes, actualizar docstrings, renombrar, formatear, traducir textos de interfaz.
- Correr `test_suite.sql` en CI y reportar.

### Regla práctica
> Si el error se detecta con una prueba automática → **Sonnet**.
> Si el error se detecta seis meses después, en una reunión con los dueños → **Opus o Fable**.

---

## 4. Para que no tenga limitaciones

Esto va para los dueños del proyecto. Cinco cosas que no son opcionales.

**1. Backups con recuperación a un punto en el tiempo.**
`pg_dump` diario no alcanza para datos financieros. Hace falta WAL archiving con PITR: poder volver a las 14:32 de ayer, antes de que alguien borrara algo. Proveedor gestionado (Neon, Supabase, RDS) o `pgBackRest` propio.

**2. La auditoría tiene que ser inmutable.**
Hoy `audit_log` es una tabla normal: quien tenga acceso a la base puede editarla. Para auditoría real hace falta un rol sin `UPDATE`/`DELETE` sobre esa tabla, y que la app se conecte con ese rol.

**3. Los IBAN y los PDF de instrucción son datos sensibles.**
Cifrado en reposo a nivel de disco, y `bank.view` como permiso separado — ya está en el modelo, falta aplicarlo en la API.

**4. Doble control en la aprobación.**
Hoy `disb.approve` es un permiso. Para montos sobre un umbral, considerá exigir dos aprobadores distintos. Es una tabla más (`disbursement_approval`) y evita la clase de problema más cara que existe.

**5. El Excel no se apaga de golpe.**
Correr ambos en paralelo un ciclo completo — un mes entero de desembolso — y comparar. El export vivo sirve justo para eso: generás el Excel desde la app y lo comparás contra el tuyo.

---

## 5. Export Excel vivo — estado actual

**Prototipo funcionando** (`export_excel.py`). El archivo generado tiene:

| | |
|---|---|
| Fórmulas vivas | **2.662** (1.886 en Job Cost, 539 en Timeline Detail, 237 en LEDGER) |
| Columnas | 82 — 52 semanas + 12 subtotales de mes + 4 de trimestre + 13 fijas + total |
| Agrupación real | 3 niveles con botones `1 · 2 · 3` y `+`/`−` |
| Colores | los 5 estados del master |
| Formato condicional | sobregiro en rojo sobre Remaining |

**Qué mejora respecto del Excel actual:**
- El original **no agrupa**: los 17 rangos están simplemente ocultos (`outlineLevel=0, hidden=True`). Colapsar es esconder columnas a mano. El export tiene grupos de verdad.
- `Timeline Detail` hereda categoría y fase del master **por fórmula** (`INDEX/MATCH`). No pueden volver a divergir como las 35 líneas de hoy.
- Los subtotales de mes y trimestre son fórmulas, no columnas vacías.
- El `TOTAL` suma todos los trimestres — sin el hueco de `GN`/`GO` del original.

**Qué falta (fase 8):** la hoja `Timeline` agregada por categoría+fase, conectarlo a la API en vez de al SQLite, y un selector de rango de fechas.

---

---

## 6. Control de wires y comisiones bancarias

### El problema

Los montos de `US Wire Transfers` son el **neto que entró**. No hay columna del bruto enviado ni de la comisión. Hoy la conciliación es imposible porque el dato no existe.

El patrón se ve igual en los 22 wires históricos, comparando contra el monto redondo más cercano:

| Comisión deducida | Veces |
|---|---|
| $30,00 | 6 |
| $25,00 | 2 |
| $40,00 | 1 |
| Otras (montos no redondos) | 7 |

16 de 22 wires con bruto redondo identificable. Comisión promedio: **$27,23**.

Ejemplos claros: `99.970` = 100.000 − 30 (cinco veces) · `19.975` = 20.000 − 25 · `92.470` = 92.500 − 30 · `67.970` = 68.000 − 30.

### El modelo

`wire_transfer` ahora separa los dos montos:

| Campo | Qué es |
|---|---|
| `amount_sent` | lo que **ellos** enviaron |
| `amount_received` | lo que **entró** a la cuenta |
| `value_date` | fecha de acreditación |

Y `wire_fee` desglosa las comisiones por cobrador, siguiendo la ruta real del wire — SunWest → Citibank (intermediario) → LAFISE (beneficiario):

| `fee_type` | Cobrador |
|---|---|
| `sending` | Banco emisor (SunWest) |
| `intermediary` | Banco intermediario (Citibank) |
| `beneficiary` | Banco beneficiario (LAFISE) |
| `fx` | Diferencial cambiario |
| `unidentified` | Sin identificar |

`wire_fee.is_estimated` marca las comisiones deducidas del estado de cuenta versus las documentadas. `wire_fee.ledger_entry_id` permite además cargar la comisión como gasto a un WBS de Overhead.

### La regla de validación

**No bloquea, marca.** El wire cae hoy y la comisión se identifica después. Lo único que se rechaza es asignar **más** comisión que la diferencia real entre enviado y recibido. Lo que falta explicar queda visible en `sin_explicar` y sale listado en `v_wire_pending`.

`wire_absorb_difference(wire_id)` es el atajo: registra toda la diferencia como una comisión estimada sin desglosarla, para cuando no vale la pena investigar.

### Vistas

| Vista | Para qué |
|---|---|
| `v_wire_reconciliation` | solicitado → enviado → comisiones → neto recibido → sin explicar, con % de comisión |
| `v_bank_fees` | cuánto se queda cada banco, por tipo, con mínimo, máximo y promedio |
| `v_bank_fees_by_year` | costo anual de mover la plata, como % del enviado |
| `v_wire_pending` | wires sin desembolso asignado, sin neto, o con comisión sin identificar |

`v_disbursement_trace` ahora separa `enviado_por_corporativo` de `neto_recibido_escrow`.

### Un hallazgo del diseño

Los tres montos **no tienen por qué coincidir**, y ese es justamente el punto:

| | |
|---|---|
| Solicitado | $21.975,35 (después del crédito aplicado) |
| Enviado | $25.000,00 (monto redondo) |
| Comisión | $24,65 |
| Neto recibido | $24.975,35 |

Corporativo manda redondo, el banco cobra en el camino, y el sobrante queda en la cuenta. Ese sobrante es exactamente el crédito que después se aplica al mes siguiente — las dos piezas encajan.

---

---

## 7. Conciliación de la cuenta LAFISE y cargos bancarios

Verificado contra el estado de cuenta real (`MovimientosDeCuenta_LAFISE_VENTANAS.xls`, 01/ENE a 22/JUL 2026, 284 movimientos, cuenta `CR49011400007813265875`).

### Hay dos capas de comisión, no una

| Capa | Dónde | Monto | Se ve en |
|---|---|---|---|
| Wire USA → escrow | Citibank / SunWest | $25 a $40 por wire | `wire_fee` |
| Cuenta operativa LAFISE | LAFISE | **$4,00 por transferencia** + **$1,50 mensuales** | `bank_tx` clasificado |

La segunda no se pide en el short payment del mes. Hay que recuperarla cada cierto tiempo — que es exactamente lo que pedías.

### Cargos e intereses 2026 (calculado desde tu archivo)

| Mes | Comisión transf. | # | Cargo adm. | Total cargos | Intereses | Neto |
|---|---|---|---|---|---|---|
| 2026-01 | 20,00 | 5 | 1,50 | 21,50 | 67,44 | +45,94 |
| 2026-02 | 20,00 | 5 | 1,50 | 21,50 | 58,47 | +36,97 |
| 2026-03 | 8,00 | 2 | 1,50 | 9,50 | 80,12 | +70,62 |
| 2026-04 | 20,00 | 5 | 1,50 | 21,50 | 80,31 | +58,81 |
| 2026-05 | 12,00 | 3 | 1,50 | 13,50 | 77,24 | +63,74 |
| 2026-06 | 24,00 | 6 | 1,50 | 25,50 | 64,62 | +39,12 |
| 2026-07 | 12,00 | 3 | — | 12,00 | 28,81 | +16,81 |
| **Total** | **116,00** | **29** | **9,00** | **125,00** | **457,01** | **+332,01** |

**Los intereses ganados ($457,01) superan a los cargos ($125,00).** La cuenta genera $332,01 netos a favor en lo que va del año. Aun así los dos flujos tienen que quedar registrados para que la cuenta cuadre contra los movimientos reales.

### Hallazgo: cada comisión trae el número de confirmación de su transferencia

LAFISE le pone a la comisión de $4,00 **el mismo número de confirmación** que a la transferencia que la generó. Eso permite ligarlas automáticamente:

| Fecha | Comisión | Pago relacionado | Monto pago | % sobre el pago |
|---|---|---|---|---|
| 2026-06-24 | 4,00 | PAGO IMPUESTO TERRITORIAL 2026 | 53.511,21 | 0,0075 % |
| 2026-06-16 | 4,00 | DEVELOPMENT TEAM JUNE 2026 | 14.125,00 | 0,0283 % |
| 2026-07-08 | 4,00 | FERRETERIA Y VETERINARIOS | 118,33 | 3,38 % |
| 2026-06-08 | 4,00 | ALIN FLUV PLANO P23185132021 | 93,73 | **4,27 %** |

La comisión es plana, así que **los pagos chicos son caros**: 0,0075 % en uno de $53 mil, 4,27 % en uno de $93. Sobre 29 transferencias el promedio es 0,8 %. Agrupar pagos pequeños del mismo proveedor ahorraría dinero real.

### Fondeos desde escrow contra los desembolsos

| Fecha | Concepto | Entró |
|---|---|---|
| 2026-01-28 | PV2 Deployment planned January | 48.069,36 |
| 2026-02-18 | PV2 Deployment February | 67.179,72 |
| 2026-03-30 | PV2 Deployment March | 23.411,25 |
| 2026-04-16 | PV2 Deployment April 2026 | 63.465,13 |
| 2026-05-14 | PV2 Deployment May 2026 | 21.355,98 |
| 2026-06-15 | PV2 Deployment Jun 2026 | **24.975,36** |
| 2026-07-16 | PV2 Deployment July 2026 | 72.696,09 |
| | **Total 2026** | **321.152,89** |

Ninguno muestra deducción: el traslado escrow → LAFISE no cobra comisión. Toda la comisión de wire ocurre en el tramo USA → escrow.

**Y resuelve la anotación A3:** entraron **$24.975,36** en junio, que coincide con el total impreso del Breakdown, no con los $24.975,35 de la carta de instrucción ni con la suma de las 9 líneas. El centavo se financió; el error está en la suma del Breakdown.

### Lo que se construyó

**`bank_movement_class`** — interés, comisión de transferencia, cargo administrativo, comisión de cambio, fondeo escrow, pago, sin clasificar.

**`bank_classification_rule`** — las reglas son **dato editable**, no código. Si LAFISE cambia el texto de un concepto, se corrige con un `UPDATE`.

**`charge_recovery`** — liga una línea de desembolso con el período de cargos que cubre. Así sabés qué meses ya pediste y cuáles no.

**Vistas nuevas:**

| Vista | Para qué |
|---|---|
| `v_bank_charges_monthly` | la pestaña que pedías: cargos e intereses por mes |
| `v_charges_pending_recovery` | cargos que todavía no pediste en ningún short payment |
| `v_transfer_fee_detail` | qué pago costó qué comisión, y a qué % |
| `v_funding_reconciliation` | fondeo recibido vs desembolso solicitado |
| `v_bank_unclassified` | bandeja de revisión |

**`import_lafise.py`** — lee el `.xls` tal cual lo bajás, clasifica, verifica que **los 284 saldos encadenen** (cada línea = anterior + crédito − débito) y es idempotente: reimportar el mismo período no duplica nada.

### Dos bugs que aparecieron al probar con el archivo real

1. **La clave de unicidad descartaba las 29 comisiones.** `UNIQUE (cuenta, fecha, nro_confirmación)` chocaba porque la comisión comparte número con su transferencia. Corregido con `UNIQUE NULLS NOT DISTINCT` sobre cuenta, fecha, número, descripción y montos.
2. **La verificación de saldos fallaba en 139 líneas.** Ordenaba por fecha y número; el orden real de asiento es el del archivo invertido. Con eso, los 284 encadenan sin una sola diferencia.

---

---

## 8. Segunda ronda de revisión (23-07-2026) — hallazgos y correcciones

Aplicado el método de 7 lentes sobre el material completo, verificando contra PostgreSQL real y contra los archivos del proyecto.

### 🔴 Lo que rompía

**R1 · `load.py` estaba roto en cuatro puntos.** Nunca se había ejecutado contra Postgres — sólo en `--dry-run`, que no toca la base. Al correrlo de verdad:

| Falla | Detalle |
|---|---|
| `wire_transfer.amount` | La columna se renombró a `amount_sent`/`amount_received`. El insert fallaba |
| `SET app.user_id = %s` | `SET` no acepta parámetros en PostgreSQL. Hay que usar `set_config()` |
| `bank_tx` duplicados | Dos comisiones idénticas el mismo día chocaban con la clave única |
| Fechas del LOG | Formato `DD-MM-YYYY HH:MM:SS`; PostgreSQL las rechazaba |

Todas corregidas y verificadas con una carga completa de punta a punta.

**R2 · `v_charges_pending_recovery` daba por cubiertos meses que no lo estaban.** Una recuperación que cubre varios meses le asignaba **el monto completo a cada mes**. Una recuperación de $52,50 por tres meses hacía ver enero (cargos $21,50) como saldado aunque sólo le tocaran $8,80. *Corrección:* vista `v_charge_recovery_applied` que prorratea según los cargos reales de cada mes.

### 🟠 Lo que costaba

**R3 · El gasto se perdía cuando el monto era cero.** `v_wbs_financials` calculaba el pago como `amount_usd * amount_paid / NULLIF(amount,0)`. Con `amount = 0` y `amount_paid = 500`, el resultado era NULL y el pago desaparecía. *Corrección:* columna generada `ledger_entry.amount_paid_usd`, sin división.

**R4 · Nueve tablas con `updated_at` sin trigger** — `bank_tx`, `budget_line`, `budget_version`, `fund_movement`, `invoice`, `wire_fee` entre otras. La columna existía y nunca se actualizaba, que es peor que no tenerla. Corregido.

**R5 · Conteos desactualizados en la documentación** — decía 32 tablas y 12 vistas; son 38 y 22. Corregido.

### 🟡 Anotado, no corregido

**R6 · Nada llena `bank_tx.fund_movement_id` ni `wire_id`.** `v_funding_reconciliation` devuelve filas con el desembolso en NULL. El emparejamiento automático es la fase 9; hasta entonces la vista existe pero no liga.

**R7 · Diez FKs sin índice**, todas hacia catálogos de menos de 10 filas (`role`, `permission`, `line_type`) o campos de usuario de baja cardinalidad. No vale la pena el índice.

**R8 · La suite no cubría el módulo bancario.** ~~Pendiente.~~ **Cerrado en la tercera ronda:** 17 pruebas nuevas cubren clasificación automática, cargos por mes, el vínculo comisión↔pago, idempotencia, prorrateo de recuperaciones y reglas editables. Total: **78 pruebas**.

---

## 9. El hallazgo de fondo: el LEDGER no tiene fechas

Verificado celda por celda: **la columna `Date` del LEDGER está vacía en las 237 filas.** La columna `Invoice #` también.

La fecha existe, pero **dentro del texto del Payee**: `Disbursement #21 - 03/01/2026`.

| | Asientos |
|---|---|
| Con número de desembolso **y** fecha en el texto | 207 |
| Con número de desembolso, sin fecha (lote `#00`) | 22 |
| Sin ninguna referencia | 8 |

Consecuencias de esto en el Excel actual:

- Ningún análisis temporal puede salir del LEDGER. La distinción REAL vs FORECAST de Power Query no puede apoyarse en él.
- No hay forma de filtrar gasto por período sin leer texto libre.
- El vínculo entre asiento y desembolso es una convención de escritura, no un dato.

`load.py` ahora extrae ambos del texto. Resultado de la carga real:

| | |
|---|---|
| Asientos cargados con fecha | **185** |
| Rango recuperado | 2024-05-06 a 2026-10-03 |
| Sin fecha recuperable (lote `#00`) | 50, por $10.871.780,43 |

El lote `#00` es la adquisición inicial —compra de propiedad, due diligence— y en el archivo no tiene fecha por ningún lado. **Necesito que definas qué fecha llevan**, o se cargan con la fecha de cierre de la compra. No la voy a inventar.

Mientras tanto la conciliación reporta honestamente `NO CUADRA` y explica la diferencia: el gasto en Postgres es $1.160.703,17 contra $11.809.117,93 del Excel, y los $10,87 M del lote `#00` explican la brecha.

### Verificación final

| | |
|---|---|
| Suite de pruebas | **78 de 78** |
| Esquema | 38 tablas, 22 vistas, `ON_ERROR_STOP=1` sin errores |
| Carga completa | 185 asientos, 1.984 celdas, 451 movimientos, 227 registros de auditoría |
| Estado de cuenta LAFISE | 284 movimientos, saldos encadenan sin diferencia |

### Veredicto

**Listo para construir, con una decisión pendiente:** la fecha del lote `#00`.

Esta ronda encontró cosas reales —`load.py` no funcionaba, y el LEDGER sin fechas es un problema de datos que había que descubrir antes de migrar— pero todas aparecieron **ejecutando**, no leyendo. Ninguna salió de releer el esquema.

Ese es el indicador de rendimientos decrecientes del método: el papel ya dio lo que tenía. Lo que sigue es cargar el archivo de agosto y construir la fase 3.

---

## 10. Orden sugerido

```
Fase 2  ──►  Fase 3  ──┬──►  Fase 4  ──►  Fase 5  ──►  Fase 8
                       │                      (ya podés dejar el Excel)
                       ├──►  Fase 6  ──►  Fase 7
                       └──►  Fase 9  ──►  Fase 10
                                              │
                                        Fase 11 (antes de dar acceso a los dueños)
```

Las ramas 4-5-8, 6-7 y 9-10 son independientes entre sí: se pueden atacar en el orden que te convenga según qué duela más.
