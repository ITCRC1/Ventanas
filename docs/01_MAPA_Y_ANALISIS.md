# DASHBOARD VENTANAS — Mapa del master file y plan de migración a app

> ⚠️ **Sobre la vigencia de este documento**
> El análisis se hizo sobre el archivo `01-07-2026`, que **está desactualizado**.
> - La **estructura** (mapa de tabs, dependencias, fórmulas, arquitectura, esquema SQL) **sigue siendo válida**: vive en la plantilla y se repite en cualquier versión.
> - Los **datos** (totales, conciliaciones, números de desembolso, descuadres puntuales) son **una foto al 01-07-2026** y no deben tomarse como cifras vigentes. Están marcados como tales y quedan en la sección 12 como anotaciones a verificar contra el reporte actual.
> - La carga inicial se hará contra el archivo del día, no contra esta foto.

> **Alcance: proyecto único.** DASHBOARD VENTANAS es exclusivo del proyecto Ventanas. No es multipropiedad y no aplica a CWL, Oxigen, Ojochal ni Amarena.

**Archivo analizado:** `VENTANAS_JOB_COST_REP_2026___01-07-2026__FINAL.xlsm` (826 KB)
**Fecha de análisis:** 23-07-2026 · *rev. 2 — mapa de columnas del Job Cost Report confirmado*
**Contenido:** 20 hojas · 12.345 fórmulas · 4 tablas · 8 gráficos · 7 consultas Power Query · 15 módulos VBA · 2 links externos

---

## 1. Mapa de tabs

| # | Hoja | Estado | Tamaño | Fórmulas | Rol en el sistema |
|---|------|--------|--------|----------|-------------------|
| 1 | **Timeline** | visible | 52×88 | 176 | Gantt resumido por Categoría/Fase. Consume `Timeline Detail`. **Capa de presentación** |
| 2 | **Timeline Detail** | visible | 101×95 | 6.650 | Gantt por WBS, semanas en `M:BT`. Jala todo por `SUMIF` desde Job Cost Report. **Capa de presentación** |
| 3 | **Job Cost Report** | visible ★ | 323×248 | 2.129 | **NÚCLEO.** 94 líneas WBS + 111 columnas semanales (`U:GJ`). Tabla `JOBCOSTREPORT` (B5:GM124) |
| 4 | JOBCOSTREPORT MONTHLY | oculta | 87×62 | 109 | Salida de Power Query `JOBCOSTREPORT` (tabla `JOBCOSTREPORT_1`, A1:BG77) — pivot mensual REAL/FORECAST |
| 5 | **DASHBOARD** | visible | 118×5 | 138 | Resumen ejecutivo. 118 fórmulas `=+'Job Cost Report'!Ixx` **una por una, hardcodeadas por fila** |
| 6 | PROJECTVENTANAS | oculta | 151×171 | 166 | Salida de Power Query `PROJECTVENTANAS` (tabla A1:FM77) — versión semanal despivoteada |
| 7 | Short Term Payments | visible | 996×27 | 89 | Lista de pagos por ejecutar. Formato libre, 78 rangos combinados |
| 8 | US Wire Transfers | visible | 40×15 | 2 | 3 wires USA→CR. Total $10.428.181,70 |
| 9 | **Ventanas II** | visible | 242×9 | 244 | Estado de cuenta LAFISE PV2 (237 movimientos) |
| 10 | **LEDGER** | visible ★ | 965×31 | 582 | **Libro de gastos.** 237 asientos. Tabla `Table1` (A6:J355). Fuente real del SPEND |
| 11 | VENTANAS I | oculta | 29×18 | 25 | Estado de cuenta LAFISE PV1 (20 movimientos) |
| 12 | Bank Statement LAFISE | visible | 163×11 | 486 | Estado de cuenta operativo (178 movimientos) |
| 13 | LOG de Cambios | visible | 226×102 | 0 | **Hoja de control.** Auditoría de cambios en columna A (STATUS) del Job Cost Report. 225 registros |
| 14 | Catastros | visible | 1002×6 | 14 | Costeo de segregación catastral: 532 unidades → $510.812 |
| 15 | Format | visible | 922×27 | 0 | Plantilla de instrucción de transferencia bancaria (IBAN, beneficiario) |
| 16 | Sheet1 | oculta | 233×222 | 1.484 | **Calendario semanal maestro** (fecha inicio de semana + Q). Espina dorsal de las columnas de tiempo |
| 17 | **INCONGRUENCES_MONTH** | visible | 517×7 | 0 | **Hoja de control.** 516 alertas: semana pintada vs. presupuesto por WBS-mes |
| 18 | Ventanas II (2) | visible | 24×7 | 3 | Corte parcial PV2 (ene-2025). Duplicado parcial de #9 |
| 19 | Bank Statement LAFISE (2) | visible | 17×11 | 48 | Corte parcial LAFISE. Duplicado parcial de #12 |
| 20 | **INCONGRUENCES_PHASE_MONTH** | visible | 91×8 | 0 | **Hoja de control.** 90 alertas agregadas por Categoría-Fase-mes |

★ = hoja núcleo

---

## 2. Grafo de dependencias

```
        [Sheet1: calendario semanal]
                    │
                    ▼
   LEDGER ──SUMIF(237)──► JOB COST REPORT ◄──SUMIF(2)── Catastros
   (asientos)                    │  ▲
                                 │  └──(3 refs de retorno: LEDGER)
                                 │
              ┌──────────────────┼───────────────────┐
              ▼                  ▼                   ▼
       Timeline Detail      DASHBOARD          Power Query
        (9.080 SUMIF)      (118 refs fijas)     JOBCOSTREPORT ──► JOBCOSTREPORT MONTHLY
              │                                  PROJECTVENTANAS ──► PROJECTVENTANAS
              ▼
          Timeline (343 refs)
              │
              ▼ (VBA lee COLORES, no datos)
   INCONGRUENCES_MONTH · INCONGRUENCES_PHASE_MONTH
```

**Conteo exacto de aristas:**

| Origen → Destino | Referencias |
|---|---|
| Timeline Detail → Job Cost Report | **9.080** |
| Timeline → Timeline Detail | 343 |
| Job Cost Report → LEDGER | 152 |
| DASHBOARD → Job Cost Report | 118 |
| LEDGER → Job Cost Report | 3 |
| Job Cost Report → Catastros | 2 |
| LEDGER → Timeline Detail | 1 |

**Fórmulas más usadas:** `SUMIF` 4.616 · `SUM` 3.427 · `FIND` 1.925 · `ISNUMBER` 771 · `LEFT/MID/RIGHT` 385 c/u · `SUMIFS` 105 · `VLOOKUP` 61 · `DAYS360` 73. Sin funciones volátiles (`INDIRECT`, `OFFSET`, `NOW`) — bien.

---

## 3. Links externos (los dos son riesgo activo)

**Link 1 — al Job Cost Report de CWL:**
```
G:\.shortcut-targets-by-id\...\3-102-865727 - CORCOVADO HOLDING SCP S.R.L\
   VENTANAS\FINANCIERO\JOB COST REPORT\Budget Control 2025\CWL-Job Cost Report (2).xlsm
```
Alimenta los nombres definidos `Project_Name`, `Project_Address` y `Area` (`'[1]Job Cost Report'!$B$11:$C$181`). Es un **Google Drive Shortcut con letra de unidad G:** — se rompe en cuanto cambie la letra o el usuario.

**Link 2 — a la versión anterior de este mismo archivo:**
```
C:\Users\finco\OneDrive\Desktop\VENTANAS 2026\VENTANAS JOB COST REP 2026 (05-05-2026) FINAL.xlsm
```
El archivo se referencia **a sí mismo en su versión anterior**. Trae en caché las 18 hojas de mayo. Cualquier cell que lo use está leyendo datos de hace 2 meses.

**Nombres definidos locales:** `PROYECTOS` = `'Job Cost Report'!$B$13:$C$120`. Existen además 29 nombres `_xlpm.*` — son parámetros de funciones **LAMBDA** en el workbook (`SUBTOTAL` custom, y variables `detalle`, `subtotal`, `sumBlock`, `lastTotalRow`…).

---

## 4. Hojas de control y cómo funcionan

### 4.1 LOG de Cambios
Escrito por `Module2.RegistrarCambios_ColumnaA_JobCostReport`. Registra `Fecha y Hora | Hoja | Fila | Valor Anterior | Valor Nuevo`. **Solo audita la columna A (STATUS)** del Job Cost Report. 225 registros desde 13-02-2025. No audita presupuestos, montos ni cronograma — que es justo donde el dinero se mueve.

### 4.2 INCONGRUENCES_MONTH / _PHASE_MONTH
Generadas por `Module1.Build_Incongruences_ByPhaseMonth_CONSOLIDATED`. Recorren `Timeline Detail` filas 11+, columnas M:BT, y comparan por Categoría-Fase-Mes:
- `HasFillVisible(cell)` — si la celda **está pintada** (usa `DisplayFormat` para capturar también el formato condicional)
- vs. si esa celda **tiene monto**

Y emiten `⚠ Planificado en Timeline sin presupuesto` / `⚠ Presupuesto sin planificar`.

**Esto es el hallazgo estructural más importante del archivo:** el cronograma no vive en los datos, vive en el **color de relleno de las celdas**. Las hojas de incongruencias existen precisamente porque no hay forma de garantizar que color y monto coincidan.

### 4.3 Sincronizadores de color (VBA)
- `Module3.PaintJobCostFromTimeline` — copia colores de Timeline `O:BV` → Job Cost `CD:GJ` (offset +67 columnas, hardcodeado)
- `SyncTimelineRowToDetail` — propaga el color de una fila de Timeline a todas las filas de Detail que coincidan con `Category|Phase`
- `ColorearFilas_SinAfectarFormato`
- `Worksheet_SelectionChange` — dispara sincronización al hacer clic

---

## 5. Power Query — 7 consultas

| Consulta | Qué hace |
|---|---|
| `CORTE` | Lee la fecha de corte de un rango nombrado `CORTE` |
| `CUTTOFDATE` | Parámetro fijo `#date(2025,1,4)` — **desactualizado 18 meses** |
| `FECHACORTE` | Fecha de corte auxiliar |
| `JOBCOSTREPORT` | La buena: limpia cabeceras, `Table.Skip(6)`, fill-down jerárquico, despivotea semanas, parsea fecha con fallback en-US/es-ES, marca `REAL` vs `FORECAST` contra `DateTime.LocalNow()`, y pivotea a `yyyy-MM-STATUS` |
| `PROJECTVENTANAS` | Filtra `Text.Contains([WBS NUMBER], ".")` sobre la tabla `VENTANAS9` |
| `PROJECTVENTANAS (2)` | Igual + despivoteo + `Date.EndOfMonth` con locale `es-CR` + comparación contra `CORTE` |
| `Table1` | Ledger |

**Problema:** `JOBCOSTREPORT` marca REAL/FORECAST contra la fecha de hoy; `PROJECTVENTANAS (2)` lo marca contra `CORTE`. **Dos definiciones distintas de "lo real"** conviviendo en el mismo archivo. Además `PROJECTVENTANAS` apunta a una tabla `VENTANAS9` que ya no existe con ese nombre.

---

## 6. Extracción ejecutada — el modelo relacional ya está armado

> 📸 **Foto al 01-07-2026.** Las cifras de esta sección sirven para **probar que el extractor y el modelo funcionan**, no como saldos vigentes. La carga real se hace contra el archivo actual.

Corrí el extractor sobre el archivo real. Resultado:

| Tabla | Filas |
|---|---|
| `wbs` | 93 |
| `ledger` | 237 |
| `schedule_week` | 2.255 |
| `bank_tx` | 451 |
| `change_log` | 225 |
| `wire` | 3 |

### Validación contra el workbook

**Totales de cartera:**

| Concepto | Monto |
|---|---|
| Presupuesto original | $15.246.006,65 |
| Cambios de presupuesto | $878.249,91 |
| **Presupuesto revisado** | **$16.124.256,56** |
| Gasto a la fecha | $11.809.117,93 |
| Saldo | $4.315.138,63 |
| Proyectado | $16.462.550,11 |

**Integridad aritmética:** ✅ 0 filas con `revisado ≠ original + cambios` · ✅ 0 filas con `saldo ≠ revisado − gasto` · ✅ **LEDGER concilia perfecto con SPEND en las 93 líneas WBS** (0 diferencias).
**⚠ 5 partidas con sobregiro** (gasto > presupuesto revisado).
**⚠ Proyectado excede el revisado en $338.293,55.**

**Bancos:**

| Cuenta | Movs. | Créditos | Débitos |
|---|---|---|---|
| PV1 | 20 | $10.428.181,70 | $10.428.149,70 |
| PV2 | 237 | $1.432.821,86 | $1.383.967,41 |
| LAFISE | 178 | $577.650,37 | $670.400,39 |
| PV2-alt | 16 | — | $81.100,00 |

Wires USA→CR: $10.428.181,70 — **cuadra exacto contra los créditos de PV1.** ✅

**Cronograma (aquí está el dolor):**
- 2.041 celdas **pintadas sin monto**
- 202 celdas **con monto sin pintar**
- 8 colores distintos en uso, sin leyenda documentada en el archivo:

| Color | Celdas | Interpretación probable |
|---|---|---|
| `FFCCCCCC` gris | 1.503 | fuera de alcance / relleno |
| `FFC8DCF0` azul claro | 163 | planificado |
| `FF38761D` verde | 144 | completado |
| `FFB85B22` naranja | 105 | en riesgo / atención |
| `FFA2C4C9` gris-azul | 97 | ? |
| `FF1155CC` azul fuerte | 28 | hito |
| `FFFFFF00` amarillo | 11 | alerta |
| `FFFFF5B4` amarillo pálido | 2 | ? |

**Este es el único dato que no puedo migrar sin vos.** Necesito que definas qué significa cada color; es la máquina de estados del cronograma y hoy solo existe en tu cabeza.

---

## 7. Bugs y deuda técnica encontrados

> Los hallazgos marcados **[E]** son **estructurales**: están en fórmulas, macros o diseño de la plantilla, y persisten en cualquier versión del archivo. Los marcados **[D]** son de **datos** de la foto 01-07-2026 y hay que reverificarlos contra el reporte actual (sección 12).

| # | Severidad | Hallazgo |
|---|---|---|
| 1 | 🔴 Alta **[E]** | `Timeline Detail!K8`: `=SUMIF('Job Cost Report'!$B:$B, $E8, 'Job Cost Report'!$L:$KS)` — rango de suma de 274 columnas. Funciona solo porque SUMIF lo redimensiona a `$L:$L`. Se rompe silenciosamente si alguien inserta una columna |
| 2 | 🔴 Alta **[E]** | El cronograma se guarda como **color de celda**. No es consultable, no es auditable, no sobrevive a copiar/pegar |
| 3 | 🔴 Alta **[E]** | Link externo a **su propia versión de mayo 2026** — datos en caché de hace 2 meses |
| 4 | 🟠 Media **[E]** | `Module3` hardcodea el offset de columnas (`O→CD = +67`). Insertar una columna rompe toda la sincronización de colores sin error visible |
| 5 | 🟠 Media **[E]** | Dos definiciones de REAL vs FORECAST (hoy vs. `CORTE`) |
| 6 | 🟠 Media **[E]** | `CUTTOFDATE` congelado en 04-01-2025 |
| 7 | 🟠 Media **[E]** | DASHBOARD con 118 referencias fijas fila-por-fila. Insertar una línea WBS desalinea el dashboard entero, en silencio |
| 8 | 🟡 Baja **[E]** | 4 hojas duplicadas parciales (`Ventanas II (2)`, `Bank Statement LAFISE (2)`, `VENTANAS I` oculta, `Sheet1`) |
| 9 | 🟡 Baja **[D]** | 3 cost codes en LEDGER que no son WBS: `Unrecorded Center`, `Service Done/Not Posted to Sage`, `Estimates & Quotes` |
| 10 | 🟡 Baja **[D]** | Espacios sobrantes en catálogos (`Overhead ` vs `Overhead`, `Partnership ` vs `Partnership`) — ya normalizados en la extracción |
| 11 | 🟡 Baja **[E]** | El LOG de Cambios solo audita STATUS, no los montos |

---

## 8. Arquitectura propuesta para la app

Mismo stack que ya usás (FastAPI + PostgreSQL + Next.js), para que se integre con el resto.

### Esquema de datos

```sql
settings(id, project_name, company, manager, currency, cutoff_date,
         horizon_start, horizon_end)          -- fila única
wbs_item(id, wbs_code, parent_id, title, owner, category_id, phase_id,
         status, kind, sort_order)
budget_version(id, version_no, effective_date, approved_by, note)
budget_line(id, wbs_id, version_id, amount)          -- original y cada cambio: histórico completo
ledger_entry(id, wbs_id, date, invoice_no, payee, description,
             currency, amount_crc, amount_usd, amount_paid, amount_due,
             funding_source, bank_tx_id)              -- FK real al banco
schedule_cell(id, wbs_id, week_start, planned_amount,
              state_id, note)                         -- ← el color se vuelve un ESTADO
schedule_state(id, code, label, color_hex, is_committed)  -- la leyenda, explícita
bank_account(id, name, iban, currency)
bank_tx(id, account_id, date, txn_no, description, debit, credit, balance,
        reconciled_ledger_id)
wire_transfer(id, date, sender, dest_account_id, amount, note)
audit_log(id, table_name, record_id, field, old_value, new_value, user_id, ts)
```

### Lo que cambia conceptualmente

| Excel hoy | App |
|---|---|
| Color de celda = cronograma | `schedule_cell.state_id` → FK a `schedule_state` |
| 9.080 `SUMIF` de Timeline Detail | Un `GROUP BY` con índice |
| Hojas INCONGRUENCES generadas por macro | Constraint + vista materializada. La incongruencia **no puede existir** |
| LOG de Cambios (solo STATUS) | `audit_log` con triggers en todas las tablas de dinero |
| Presupuesto original + columna de cambios | `budget_version` — historial completo, quién aprobó qué y cuándo |
| Link externo a CWL | Se elimina. El dato que traía (`Project_Name`, `Address`, `Area`) pasa a `settings` |
| Power Query REAL vs FORECAST | Campo calculado contra `settings.cutoff_date`, una sola definición |
| DASHBOARD con refs fijas | Query agregada, imposible desalinear |

### Vistas / pantallas

1. **Dashboard** — presupuesto vs. gasto vs. proyectado por categoría, alertas de sobregiro
2. **Job Cost Report** — grilla editable de WBS, es la pantalla donde vive el día a día
3. **Cronograma** — Gantt real con estados, drag para reprogramar, monto por semana editable en la celda
4. **Ledger** — captura de asientos con conciliación bancaria asistida
5. **Bancos** — importar estado LAFISE, matchear contra ledger
6. **Draw requests** — la columna `Current Draw Request` merece su propio flujo de aprobación
7. **Auditoría** — quién cambió qué

### Fases de implementación

| Fase | Entregable | Estado |
|---|---|---|
| 0 | Mapeo + extractor + validación | ✅ **hecho, en este entregable** |
| 1 | Leyenda de colores → `schedule_state` | ✅ **hecha** (filas 129-133 del master) |
| 2 | Esquema PostgreSQL (`schema.sql`) | ✅ **entregado** — falta carga y conciliación |
| 3 | API FastAPI (CRUD WBS, ledger, schedule) + audit triggers | |
| 4 | Front Next.js: Dashboard + Job Cost grid | |
| 5 | Cronograma Gantt con estados | |
| 6 | Conciliación bancaria + import LAFISE | |

---

---

## 9. Mapa de columnas del Job Cost Report (confirmado con el usuario, 23-07-2026)

El Job Cost Report es el **master file**: de aquí se deriva todo lo demás.

### Bloques de columnas

| Rango | Contenido | Estado |
|---|---|---|
| `A` | STATUS | activo — único campo auditado por el LOG de Cambios |
| `B` | **WBS NUMBER** | clave del sistema. Referenciada 4.616 veces desde otras hojas |
| `C:F` | Task title, owner, categoría, fase | activo |
| `G:M` | Presupuesto original, cambios, revisado, spend, remaining, forecast, varianza | activo |
| `N:O` | Current Draw Request / Draw # | activo |
| `P` | Remaining 4 | **activo** — alimenta `L` (`FORECASTED = J + P`), 80 referencias externas |
| `Q:S` | START DATE / DUE DATE / DURATION | **muerto.** `DURATION` = 749 días repetido; cero referencias externas. Reservado para uso futuro |
| `T` | PCT OF TASK/EXPENSE COMPLETE | **huérfano.** 80 valores, uno de ellos 1,83 (183 %); cero referencias externas |
| `U:GO` | **109 columnas semanales**, de 06/10/2024 a 31/01/2028 | activo. `CD` = 05/01/2026, inicio del bloque vigente |
| `CH, CM, CX, DB, DL, DV, EA` | `Column1`…`Column8` | **spacers vacíos.** No agregan nada |
| `GQ` | TOTAL = `=SUM(U:GL)` | control |
| `GR` | Remaining = `=I − GQ` | control |

### Jerarquía temporal

Semanas (`U:GO`) → meses → trimestres. **Pero el colapso a mes/trimestre no existe como dato en la hoja.** Los rótulos `JANUARY` (fila 7) y `Q1 2026` (fila 6) son solo encabezados sobre el bloque semanal; las columnas `Column1`…`Column8` que parecen subtotales están vacías. La única agregación real ocurre en Power Query, fuera de la hoja.

### Bugs confirmados en este bloque

| # | Severidad | Hallazgo |
|---|---|---|
| 12 | 🔴 Alta **[E]** | **Timeline Detail se corta en diciembre 2026.** Sus 9.080 `SUMIF` referencian `CD:EJ` y nada de `EK:EM` (Q1 2027). Al extender semanas en el master, el Gantt deja de ver el gasto sin dar error |
| 13 | 🟠 Media **[E]** | `GQ` suma `U:GL`, dejando fuera `GN` y `GO` (últimas 2 semanas de enero 2028). Hoy vacías; el total se quedará corto en silencio al cargar 2028 |
| 14 | 🟠 Media **[D]** | **`CX59` = 15.000** dentro del spacer `Column4`, fila `3.5.1 – Schematic design`. Como `GQ` suma de corrido, ese monto **sí entra** al total de la línea. Verificar si es legítimo mal colocado o basura |
| 15 | 🟠 Media **[E]** | Fila 16 mezcla criterios: `G16` usa `SUBTOTAL(109,…)` y `GQ16` usa `SUM(…)`. Bajo filtro, los totales de la izquierda y la derecha discrepan |

### Requisito de diseño: el horizonte tiene que crecer solo

El bloque semanal debe extenderse en el tiempo sin intervención manual. Hoy eso implica insertar columnas en el master y reextender a mano las 9.080 fórmulas de Timeline Detail — origen directo del bug #12.

**Resolución en la app:** el bloque semanal deja de ser columnas.

```sql
schedule_cell(id, wbs_id, week_start, planned_amount, state_id, note)
```

- Una fila por semana: extender el horizonte inserta **filas**, no columnas. Nada se desalinea.
- Mes y trimestre son `GROUP BY` sobre `week_start`, no columnas físicas — una sola representación del dato, imposible que las tres se contradigan.
- `Timeline` y `Timeline Detail` dejan de ser hojas: son dos niveles de agregación de la misma consulta (Detail = por WBS; Timeline = por Categoría + Fase). Los 9.080 `SUMIF` colapsan en una query.
- `GQ` / `GR` pasan a ser columnas calculadas, imposibles de dejar cortas.
- `Q:S` se descartan del modelo inicial; si más adelante se quieren fechas de tarea, entran como `wbs_item.start_date` / `due_date` con `duration` **derivada**, no capturada.

---

---

## 10. Alcance definitivo de la app (confirmado 23-07-2026)

**Entran a DASHBOARD VENTANAS — 7 tabs:**

| Tab | Rol en la app |
|---|---|
| Job Cost Report | Regente. Presupuesto vs actuales |
| Timeline Detail | Vista agregada por WBS |
| Timeline | Vista agregada por categoría + fase |
| **Short Term Payments** | **Solicitud mensual de fondos** (un short payment por mes) |
| **LEDGER** | Control de pagos ejecutados; a futuro, detalle de facturas |
| **Bank Statement LAFISE** | Cuenta operativa Ventanas — desde aquí se paga hoy |
| **Ventanas II** | Cuenta ESCROW (Alta Batalla) — receptora del wire |
| **US Wire Transfers** | Fondos enviados desde USA = montos de los short payments |

**No pasan a la app:** JOBCOSTREPORT MONTHLY, PROJECTVENTANAS, DASHBOARD, Sheet1, Catastros, Format, LOG de Cambios, INCONGRUENCES_*, VENTANAS I, y los duplicados `(2)`. Sus funciones quedan cubiertas por vistas o dejan de ser necesarias.

## 11. Ciclo del desembolso

```
Short Payment del mes  (recurrentes precargados + gastos que entran al cierre)
        │
        ├──► PDF Breakdown        (detalle por línea, con Category / Type / Reason)
        └──► PDF Instrucción      (carta que firma Corporativo)
                │
                ▼
        Wire  Hovde Master ──► cuenta ESCROW (Alta Batalla / Ventanas II)
                │
                ▼
        Traslado ──► cuenta operativa LAFISE Ventanas
                │
                ▼
        Pagos individuales ──► LEDGER ──► factura con detalle (a futuro)
                │
                ▼
        Job Cost Report: presupuesto vs actual  (vía Cost Code = WBS)
```

Numeración de control: `#23` = mayo 2026 (último cerrado) · `#24` = junio 2026 · `#25` = julio 2026 (pendientes de cargar).

### Hallazgos del ciclo

| # | Severidad | Hallazgo |
|---|---|---|
| 16 | 🔴 Alta **[D]** | **`US Wire Transfers` se quedó en `#19`.** El LEDGER ya va en `#23`: cuatro desembolsos sin wire registrado. La fila 33 tiene `Disb. Request #20` vacía |
| 17 | 🟠 Media **[D]** | **El `#17` no existe en el LEDGER** (salta de `#16` a `#18`), pero sí está en `US Wire Transfers` (15-12-2025, $93.960,94). Los dos tabs no concuerdan en la numeración |
| 18 | 🟠 Media **[D]** | **Descuadre de un centavo en junio 2026.** Verificado sumando las 9 líneas: dan $24.975,**35**. La Instrucción está correcta; **el total impreso en el Breakdown es el erróneo** |
| 19 | 🟠 Media **[E]** | **El LEDGER se titula "Corcovado Wilderness Lodge / Corcovado Costa Rica".** `B2` y `B3` son `=Project_Name` y `=Project_Address`, que resuelven contra el link externo al archivo de CWL. El ledger de Ventanas lleva el nombre del proyecto equivocado |
| 20 | 🟡 Baja **[D]** | Numeración duplicada en `US Wire Transfers`: `#1` aparece en las filas 11 y 15 con montos distintos; `#2` en las filas 12 y 13. Fechas con typo (`06/05/-2024`) |
| 21 | 🟡 Baja **[E]** | `Short Term Payments` es formato libre con 78 rangos combinados: cada mes se reteclean nombre, banco, beneficiario e IBAN de los mismos proveedores |

### Cómo lo resuelve el módulo (`schema_disbursements.sql`)

- **`payee`** — catálogo de contrapartes con banco, beneficiario e IBAN. Se elige, no se reteclea.
- **`recurring_item`** — planillas, fees y CCSS se precargan al abrir el mes; sólo se ajusta lo que cambió y se agregan los gastos del cierre.
- **`disbursement` / `disbursement_line`** — un encabezado por mes con `disb_no` único, y un trigger que recalcula el total desde las líneas. El descuadre de un centavo deja de ser posible.
- **`disb_lock_after_approval`** — aprobado el desembolso, el monto no cambia sin excepción explícita.
- **`wire_transfer.disbursement_id`** y **`fund_movement`** — el eslabón que hoy no existe: cada wire y cada traslado escrow→LAFISE quedan atados a su solicitud.
- **`invoice` / `invoice_line`** — el detalle de facturas que todavía no llevás, ya modelado y ligado a `ledger_entry`. La reconciliación queda lista para recibirlo sin rehacer nada.
- **`v_disbursement_trace`** — solicitado / recibido / trasladado / pagado, por desembolso.
- **`v_disbursement_gaps`** — huecos de numeración: habría cantado el `#17` el mismo día.
- **`instruction_template`** — el texto de la carta queda fijo (acuerdo de escrow, bancos, SWIFT, ABA, IBAN, firmante). Al generar el PDF sólo cambian monto, mes y fecha.

---

---

## 12. Anotaciones — pendientes de verificar contra el reporte actual

El archivo `01-07-2026` está desactualizado. Estos hallazgos son de **datos**, no de estructura: **no se resuelven aquí**, se reverifican contra el reporte del día antes de la carga inicial.

| # | Anotación | Qué revisar en el archivo vigente |
|---|---|---|
| A1 | `US Wire Transfers` llegaba a `#19`; el LEDGER iba en `#23` | ¿Se pusieron al día los wires `#20`–`#25`? |
| A2 | El `#17` no aparecía en el LEDGER pero sí en `US Wire Transfers` ($93.960,94, 15-12-2025) | ¿Se anuló, se renumeró, o falta cargarlo? |
| A3 | ~~Junio 2026: Breakdown vs Instrucción~~ **Resuelto:** las 9 líneas suman $24.975,**35** — la carta está bien, el total del Breakdown está mal | Confirmar que el wire salió por $24.975,35 |
| A4 | Desembolsos `#24` (junio) y `#25` (julio) sin cargar | Deben existir en el archivo actual |
| A5 | `CX59` = 15.000 dentro de una columna spacer, contado en el total de la línea | ¿Sigue ahí? ¿Es legítimo? |
| A6 | 5 partidas con gasto > presupuesto revisado | Revalidar contra cifras vigentes |
| A7 | `8.3 Finalize Creation of Concessions` sin fase asignada | Parte de la reasignación pendiente |
| A8 | Categoría `Construction` en Timeline sin ninguna línea WBS | ¿Placeholder o huérfana? |
| A9 | Cost codes no-WBS en LEDGER: `Unrecorded Center`, `Service Done/Not Posted to Sage`, `Estimates & Quotes` | ¿Son cuentas puente de Sage? |
| A10 | `Property Sale` (WBS `6`, −$480.000) — venta en proceso | Confirmado como `proceeds`. ¿Se concretó? |

**Qué NO cambia con la versión del archivo:** el mapa de tabs, el grafo de dependencias, la leyenda de colores, los 9.080 `SUMIF`, el corte de Timeline Detail en diciembre 2026, el rango incompleto de `GQ`, el link externo, el encabezado de CWL en el LEDGER, y el esquema SQL completo. Todo eso vive en la plantilla y se repite en cualquier versión.

### Procedimiento de carga inicial

1. Recibir el archivo vigente al día.
2. Correr `extract.py` sin cambios — el extractor lee estructura, no cifras fijas.
3. Correr `validate.py` y comparar contra el propio archivo, no contra esta foto.
4. Resolver las anotaciones A1–A10 con las cifras vigentes.
5. Cargar a Postgres y conciliar línea por línea antes de tocar nada más.

---

---

## 13. Validación ejecutada contra PostgreSQL real (23-07-2026)

No es revisión de papel: se instaló **PostgreSQL 16.14**, se corrió `schema_v2.sql` completo y se ejercitó cada regla con datos reales del proyecto.

### Resultado

| Lente | Pruebas | Pasan |
|---|---|---|
| 2 · Seguridad y auditoría | 5 | 5 |
| 3 · Modelo de datos | 16 | 16 |
| 4 · Extensibilidad | 5 | 5 |
| 5 · Coherencia | 4 | 4 |
| 7 · Lógica y casos borde | 19 | 19 |
| Casos borde y destructivos | 14 | 14 |
| **Total** | **61** | **61** |

El esquema se ejecuta con `ON_ERROR_STOP=1` sin un solo error: 38 tablas, 22 vistas, 44 objetos en `information_schema`.

### Dos bugs reales encontrados y corregidos

**BUG A — 🔴 la reasignación de categoría era imposible.**
`trg_wbs_phase_match` y `trg_wbs_recat` eran dos triggers `BEFORE` separados. PostgreSQL los dispara **en orden alfabético**, así que el validador corría primero y rechazaba el cambio antes de que el limpiador pudiera descartar la fase huérfana. Toda reasignación fallaba con *"La fase X no pertenece a la categoría Y"*.

Esto habría bloqueado **la función central de la app** — justo el trabajo de reasignación que está pendiente. No se detecta leyendo el SQL; sólo aparece al ejecutarlo.

*Corrección:* un solo trigger `wbs_enforce_category_phase()` que limpia primero y valida después, más una tercera regla que impide fase sin categoría.

**BUG B — 🟡 tipos numéricos inconsistentes en las vistas de crédito.**
`v_credit_balance` devolvía `7308.97000000` y `0` (entero) según el caso. Una API que expone eso obliga al front a normalizar. *Corrección:* `ROUND(...,2)::numeric(16,2)` en las tres vistas.

### Un hallazgo de negocio: el centavo de junio 2026 estaba al revés

Al cargar las 9 líneas reales del Breakdown, el total dio **$24.975,35**, no $24.975,36.

| Línea | Monto |
|---|---|
| Development Team - JUNE 2026 | 14.125,00 |
| Admin Fee + Financial Controller 25% | 3.750,00 |
| CCSS (Social Security) | 800,00 |
| Alexi Payment - Care Taker | 1.824,71 |
| Expense Reimbursement – Alexis | 329,38 |
| ALTA BATALLA: Setena (3.475 + IVA 13 %) | 3.926,75 |
| INVU Clearance P-44195-2024 | 91,29 |
| INVU Clearance P-2318513-2021 | 91,29 |
| Water Consumption ASADA | 36,93 |
| **Suma real** | **24.975,35** |

**La carta de instrucción ($24.975,35) es la correcta.** El total impreso en el Breakdown ($24.975,36) es el que está mal, por un centavo, contra sus propias líneas. Corrige la anotación A3 en sentido opuesto al que se había asumido.

### Rendimiento con volumen a 5 años

| Volumen | |
|---|---|
| Líneas WBS | 203 |
| Celdas de cronograma | 52.202 |
| Asientos de ledger | 4.952 |

| Vista | Tiempo |
|---|---|
| `v_wbs_financials` | 3,4 ms |
| `v_timeline` | 13,6 ms |
| `v_timeline_month` | 13,5 ms |
| `v_budget_vs_actual` | 0,6 ms |
| `v_credit_balance` | 1,0 ms |
| `v_disbursement_trace` | 0,5 ms |

Las 52.202 celdas equivalen a más de 5 años de cronograma. Los 9.080 `SUMIF` del Excel se reemplazan por consultas de milisegundos.

### Escenarios verificados de punta a punta

- Reasignación masiva de categoría → fases huérfanas caen en la bandeja → todo auditado con autor
- Desembolso #24 con las 9 líneas reales → aplicación parcial de crédito → wire → traslado a LAFISE → trazabilidad cuadrada
- Intento de editar desembolso aprobado → rechazado con instrucción de emitir #24.1
- Sub-desembolso #24.1 → acepta líneas → no cuenta como hueco de numeración
- Detección del hueco del #17 con los 23 desembolsos cargados
- Crédito aplicado hasta agotar el saldo exacto; un centavo más se rechaza
- Gasto en colones (₡18.841 × 0,00196) → dolarizado a $36,93
- Anulación de desembolso sin perder los pagos asociados
- Borrado en cascada con triggers de recálculo activos
- Fechas incoherentes, tasa de cambio en cero, traslado a la misma cuenta: todos rechazados

---

## 14. Lo que necesito de vos para seguir

1. ~~La leyenda de colores~~ **Resuelta: estaba en el propio archivo, Job Cost Report filas 129-133** (Green=Completed, Blue=Approved, Red=Attention, Yellow=In process, Grey=Not Started).
2. Los 5 sobregiros: ¿son reales o error de captura?
3. `Unrecorded Center` / `Service Done/Not Posted to Sage` / `Estimates & Quotes` — ¿son cuentas puente de Sage? Si sí, entran como `funding_source`, no como WBS.
4. ¿Quiénes van a usar la app y con qué permisos? (vos, Blake, la sociedad, auditores)
5. ~~¿Multi-propiedad?~~ **Resuelto: proyecto único, solo Ventanas.**
