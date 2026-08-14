# 04 · Backlog de réplica fiel — Excel master → App

> **Objetivo:** replicar `VENTANAS JOB COST REP 2026 (01-08-2026) FINAL.xlsm` al **100%**, tab por tab.
> Generado de una auditoría de fidelidad (5 grupos de tabs) contra la versión FINAL 01-08-2026.
> Marcado: ✅ replicado · ⚠️ simplificado · ❌ falta.

## Estado global

| Tab del Excel | Superficie app | Estado |
|---|---|---|
| Job Cost Report | `job-cost` (JobCostFull) | ⚠️ base sí, faltan columnas y agrupación |
| Timeline / Timeline Detail / PROJECTVENTANAS | `schedule` (ScheduleGrid) | ⚠️ matriz sí, faltan presupuesto/subtotales/multi-año |
| Short Term Payments | `payments` | ⚠️ base sí, faltan WBS/Category, wires, recurrentes |
| US Wire Transfers | `bank`/disbursements | ⚠️ conciliación sí, falta la hoja-registro como vista |
| Bank LAFISE / Ventanas I / Ventanas II | `bank` | ⚠️ cargos sí, **falta estado de cuenta con saldo encadenado** |
| DASHBOARD | `dashboard` | ✅ fiel (incluso enriquecido) |
| LEDGER | router `ledger` + `/ledger` | ✅ **hecho (local)** — vista `v_ledger` + tabla fiel + panel escrow |
| LOG de Cambios | tabla `audit_log` | ⛔ **EXCLUIDO (owner)** |
| INCONGRUENCES month / phase-month | — | ⛔ **EXCLUIDO (owner)** |
| Catastros | — | ⛔ **EXCLUIDO (owner)** |

Basura/duplicados (no se replican): `Sheet1`, `Sheet2`, `Format`, `Ventanas II (2)`, `Bank Statement LAFISE (2)`, `Recon I362`.

---

## A. Job Cost Report (el regente)

1. **Agrupar por sección WBS numerada** (0..9 con su título: Property Holding, Master Planning, Water, Concessions…) en vez de por `category`.
2. Columna **% Complete** (`spend/revised`) con **color scale** rojo→amarillo→verde (col T).
3. Columnas **START DATE / DUE DATE / DURATION** (`DAYS360`) — hoy ausentes.
4. Columna **Forecasted Spend (Following Draws)** (col P) = suma timeline desde semana de corte; **Forecast = Spend + P** (fórmula, no input manual).
5. **2ª columna Draw #** (col O) además de "Current Draw Request".
6. **Validación de WBS duplicado** → resaltar en rojo (replica `duplicateValues`).
7. **Vista Mensual basada en `*-REAL`** de `JOBCOSTREPORT MONTHLY` + columna **Variance** (hoy solo agrega semanas).
8. **Outline colapsable** por sección.
9. **Extender timeline a Q1 2028** (sembrar semanas 06/10/2024→31/01/2028).
10. Filas **Project Totals por fase** (además del PROJECT TOTAL plano).
11. Columna **Remaining secundaria** (col 200 = Revised − Timeline TO DATE).
12. **Cabecera doble** trimestre/mes (fila 6/7).
13. Tratamiento de **líneas de ingreso** (row 92 Property Sale = −480000).
14. **Leyenda de estados** visible (filas 129–133).
15. **Metadata de cabecera** (Project Title, PM, Company, UPDATED, cut-off Day).

## B. Cronograma (Timeline / Detail / PROJECTVENTANAS)

1. **Columnas de presupuesto en el grid**: Budget Revised / YTD Expense / Remaining / Forecast / Funding Pending (desde `v_wbs_financials`).
2. Fila **subtotal `TOTAL Category`** por categoría.
3. Columna **Total Año / FULL Year**.
4. Columnas **Categoría / Fase / Subfase / Owner** visibles en la columna izquierda (hoy solo code+title).
5. **Cabecera de dos niveles** (trimestre sobre mes).
6. **Horizonte multi-año configurable** (2024–2028; hoy es min/max de celdas).
7. **Split Original → Change → Revised → Spend → Remaining** (estilo PROJECTVENTANAS).
8. **Separar planificado vs ejecutado** (Detail muestra ejecutado SUMIF ledger; app solo guarda `planned_amount`).
9. Totales **mes + trimestre como columnas simultáneas** (no solo toggle).
10. **Etiqueta de texto** (frente de obra, ej. "Pinuelas Arriba") en la celda-barra.
11. **Agrupamiento visual por categoría** (encabezados de sección Gantt).
12. Aclarar label del estado **Attention** ("Red" en leyenda pero color real marrón #B85B22).

## C. Short Term Payments

1. **Sembrar los 4 recurrentes reales** (Development Director 14.125 · Admin Fee+FC 25% 3.750 · Farm Manager/Alexi 1.600 · CCSS 800) con su `wbs_id` y `reason`.
2. **Mostrar WBS/Project Number** en la lista y en el Breakdown PDF.
3. **Category / Type / Reason en la vista lista** (hoy solo en PDF).
4. Soportar `transfer = LAFISE` (además de SEND/HOLD) con su badge.
5. **Replicar la hoja US Wire Transfers**: entidad "Wire" (Trans#, Hovde Master/SunWest → Alta Batalla Escrow, fecha, monto) ligada al desembolso al pasar a `funded`.
6. **Saldo LAFISE corrido** (fila 45 de US Wire Transfers).
7. Separar **Contract Amount** de **Reason** en el modelo de línea.
8. **Completar la plantilla de Instrucción** con datos reales de escrow (purchaser, agente, cédula, firmante) — hoy placeholder con corchetes.
9. **Sub-agrupación por lote** (`Cinco Ventanas Lot` / `Ventanas`) dentro de la tanda.
10. Mapear **estados por línea** ("Ok" → settled/transferred).
11. Alinear **numeración** disb_no ↔ "Disb. Request #N" (secuencia #1..#25).
12. **Importador del histórico** de ~20 tandas 2024–2026 desde el .xlsm.

## D. Bancario (Wires / LAFISE / Ventanas I-II)

1. **Vista de estado de cuenta por `bank_account`** (movimientos + saldo encadenado + saldo inicial/final) — cubre LAFISE, Ventanas I y Ventanas II. **(mayor faltante)**
2. **Columna "Cuenta"** en las tablas "Cargos por mes" y "Por recuperar" (hoy `c.cuenta` solo se usa como key → ambigüedad multi-cuenta). *(bug de fidelidad)*
3. **Importador de estados de cuenta** (LAFISE / Ventanas I / II) → `bank_tx` con `balance`, disparando `classify_bank_tx`.
4. **Capturar/mostrar `value_date`** (fecha valor) en el alta y la fila de wire.
5. **Mostrar `solicitado` y `dif_solicitado_enviado`** en la tabla de conciliación (el título ya lo promete).
6. **Exponer `v_bank_unclassified`** como bandeja de trabajo (endpoint + UI).
7. **Superficie para `/fees` y `/fees-by-year`** (cuánto se queda cada banco + costo anual).
8. **Desglose de cargos** por tipo (comisión transf. / cargo admin / comisión cambio), no solo el total.
9. **Editor de reglas de clasificación** (`bank_classification_rule` es dato editable).
10. **Doble saldo de conciliación** (saldo banco vs recomputado, columna "xxx").
11. Campos **sender / from_bank** en el alta de wire.
12. **Detalle comisión↔pago** (`v_transfer_fee_detail`, número de confirmación compartido) como drill-down.

## E. Superficies nuevas (faltan por completo)

> ⛔ **FUERA DE ALCANCE (owner 2026-07-25):** los bloques **E2 (LOG de Cambios/Auditoría)**, **E3 (Incongruencias)** y **E4 (Catastros)** quedan **EXCLUIDOS** de la réplica — el owner no los quiere. No construirlos.

### E1 · LEDGER (API existe, falta UI) — ✅ HECHO (local)
1. **`LedgerView` + `web/app/ledger/page.tsx`** consumiendo `GET /ledger` (ya existe): Cost Code, Account, Date, Invoice#, Payee, Description, Amount, Amount Paid, Amount Due, Bank Paid From, Notes.
2. **Modelar el bloque escrow/funding** del LEDGER (Funding, CLASS, DRAW Date, REQUESTED / RECEIVED IN ESCROW / RELEASED FROM ESCROW / REMAINING) — verificar schema; si falta, migración.
3. Totales/subtotales del LEDGER (PAID TOTAL por cost code, remanente de escrow) desde vistas BD.

### E2 · LOG de Cambios / Auditoría — ⛔ EXCLUIDO (owner)
4. **Endpoint `GET /audit-log`** (solo lectura, permiso `report.view`) sobre la tabla `audit_log` inmutable ya existente.
5. **Vista `web/app/audit/page.tsx`**: fecha-hora, entidad afectada, campo, valor anterior → valor nuevo, autor.

### E3 · Incongruencias — ⛔ EXCLUIDO (owner)
6. Vista SQL **`v_incongruences_month`** (Timeline coloreado vs Budget por tarea/mes → texto Alert).
7. Vista SQL **`v_incongruences_phase_month`** (agregado por fase/mes: Rows Colored / Rows With Budget).
8. Exponer ambas vía `reports.py` (whitelist `_VIEWS`).
9. **`IncongruencesView`** (`web/app/incongruences/page.tsx`) con filtro y badge de alerta.

### E4 · Catastros — ⛔ EXCLUIDO (owner)
10. **Modelo + tabla `catastros`** (Type, Average M2, Price, Units, Total Expense, Note) + seed (SF Lot, MD Villas, Hotels, Amenities, Branded Resi, Service Areas).
11. **API `GET /catastros`** (solo lectura).
12. **`CatastrosView`** (`web/app/catastros/page.tsx`) con subtotal de unidades + Total Expense + nota "For hotel developer to pay".

### E5 · Navegación
13. Agregar al `AppShell`: **Ledger · Auditoría · Incongruencias · Catastros**.

---

## Orden de ataque sugerido

**Ola 1 — superficies nuevas:** `E1 LEDGER` ✅ hecho (local) + `E5 nav` ✅.
⛔ Catastros, Auditoría/LOG e Incongruencias **excluidos por el owner** (2026-07-25) — la Ola 1 queda cerrada con LEDGER.

**Ola 2 — el regente Job Cost (A):** agrupación por sección WBS, % Complete, Start/Due/Duration, Draw#2, Forecast por fórmula, vista Mensual REAL+Variance.

**Ola 3 — Cronograma (B):** columnas de presupuesto + subtotales + Total Año + horizonte multi-año + planificado-vs-real.

**Ola 4 — Short Payments + Wires (C):** recurrentes reales, US Wire Transfers como vista, WBS/Category visibles, saldo LAFISE.

**Ola 5 — Bancario (D):** estado de cuenta por cuenta (Ventanas I/II/LAFISE), importadores, columna Cuenta, vistas analíticas.

> **Datos frescos:** el archivo es la versión FINAL 01-08-2026 — más nueva que con la que se construyó la app. Antes de dar por cerrado cada tab, re-importar/verificar contra esta versión (timeline extendido a 2028, tandas nuevas, movimientos bancarios).
