# DASHBOARD VENTANAS

App de control financiero del proyecto de inversión **Ventanas**, que reemplaza al master file `VENTANAS_JOB_COST_REP_2026.xlsm`.

**Proyecto único.** No es multipropiedad: no aplica a CWL, Oxigen, Ojochal ni Amarena.

Estado a 23-07-2026: **modelo de datos terminado y validado. Listo para construir la API.**

---

## Qué hay en cada carpeta

```
DASHBOARD_VENTANAS/
├─ README.md              ← estás aquí
├─ CLAUDE.md              ← contexto para Claude Code (leelo primero al abrir el proyecto)
├─ DECISIONES.md          ← stack y patrones YA APROBADOS. No hay que consultarlos
├─ requirements.txt
├─ .env.example           → copiar a .env
│
├─ docs/
│  ├─ 01_MAPA_Y_ANALISIS.md        Mapa de los 20 tabs del Excel, grafo de
│  │                               dependencias, 21 hallazgos y anotaciones
│  ├─ 02_PLAN_FASES_Y_MODELOS.md   Stack, 11 fases, qué modelo usar en cada una,
│  │                               wires y comisiones, conciliación LAFISE
│  ├─ 05_DESPLIEGUE_RAILWAY.md     Runbook de producción: servicios, variables,
│  │                               primer deploy y trampas resueltas
│  ├─ 06_INVENTARIO.md             Dónde vive cada pieza: repo, Railway, entorno
│  │                               local, respaldos y cómo cargar el proyecto
│  └─ 07_TRASPASO_A_FINANCE.md     Runbook para pasar la titularidad a finance@
│
├─ db/
│  ├─ schema_v2.sql       El modelo: 38 tablas, 22 vistas. Corre limpio en PG16
│  └─ test_suite.sql      78 pruebas. Todas verdes en base limpia
│
├─ etl/
│  ├─ extract.py          .xlsm → SQLite (lee estructura, no cifras fijas)
│  ├─ validate.py         chequeos de integridad sobre la extracción
│  ├─ load.py             SQLite → PostgreSQL, con --reconcile
│  ├─ import_lafise.py    estado de cuenta LAFISE (.xls) → bank_tx
│  └─ export_excel.py     PostgreSQL → Excel vivo con fórmulas y colapso
│
├─ data/
│  ├─ 2026-08/            extracción del archivo vigente (269 asientos)
│  └─ 2026-07/            foto anterior, sólo referencia
│
└─ entregables/
   ├─ VENTANAS_REASIGNACION_CATEGORIAS.xlsx   76 líneas con diagnóstico
   └─ DASHBOARD_VENTANAS_modelo_vivo.xlsx     prototipo del export
```

---

## Puesta en marcha

```bash
python -m venv .venv && .venv\Scripts\activate     # Windows
pip install -r requirements.txt
copy .env.example .env                              # y editar

createdb dashboard_ventanas
psql %DATABASE_URL% -v ON_ERROR_STOP=1 -f db/schema_v2.sql
psql %DATABASE_URL% -f db/test_suite.sql            # debe dar 78/78

python etl/extract.py "ruta\al\VENTANAS_JOB_COST_REP.xlsm"
python etl/validate.py data/2026-08/ventanas.db
python etl/load.py --sqlite data/2026-08/ventanas.db --reconcile
python etl/import_lafise.py "ruta\al\MovimientosDeCuenta_LAFISE.xls"
```

`load.py --reconcile` compara contra el propio Excel y dice CUADRA o NO CUADRA.
Nunca inventa datos: lo que no puede resolver lo reporta.

---

## Despliegue

El repo está listo para **Railway**: tres servicios en un proyecto —`web` (Next.js,
el único con dominio público), `api` (FastAPI, sólo en la red privada) y Postgres.
El front reenvía `/api/*` al backend, así que la cookie de sesión viaja same-origin
y los IBAN de beneficiarios nunca quedan expuestos a internet.

| Archivo | Para qué |
|---|---|
| `railway.json` | servicio `api` — build desde la raíz del repo (la migración `0001` necesita `db/schema_v2.sql`) |
| `api/Dockerfile` | imagen de la API: libs de WeasyPrint, `alembic upgrade head` y gunicorn |
| `web/railway.json` · `web/Dockerfile` | servicio `web`, salida standalone de Next |
| `.dockerignore` · `web/.dockerignore` | recorte del contexto; los `.env` nunca entran a la imagen |

Pasos, variables y trampas resueltas: **`docs/05_DESPLIEGUE_RAILWAY.md`**.

---

## Trabajo sin interrupciones

`DECISIONES.md` deja preaprobado todo el stack, las librerías, los patrones de código y qué puede hacer Claude Code por su cuenta.

Sólo quedan cinco cosas que requieren decisión: reglas de negocio que únicamente vos conocés, cualquier acción contra producción, cambios al significado del modelo ya validado, envíos hacia afuera, y gasto de dinero.

Todo lo demás avanza solo, con un checkpoint de una página al cerrar cada fase.

## Las cuatro decisiones que hacen que todo funcione

1. **El Job Cost Report es el regente.** Categoría y fase viven sólo en `wbs_item`. Reasignar es un `UPDATE`; Timeline y Timeline Detail son vistas del mismo dato, no copias. Se acabó la divergencia de 35 líneas.

2. **El cronograma deja de ser color de celda.** `schedule_cell(wbs_id, week_start, planned_amount, state_id)`. Extender el horizonte inserta filas, no columnas. Mes y trimestre son `GROUP BY`, no columnas físicas.

3. **Un pago sin fecha no existe; un compromiso sin pagar, sí.** Constraint `pago_exige_fecha`. Los 18 compromisos del lote `#00` entran como `pending` sin inventarles fecha.

4. **Los totales son triggers, no celdas.** El descuadre de un centavo entre el Breakdown y la carta de instrucción no puede volver a ocurrir.

---

## Pendientes (nada bloquea empezar)

| # | Qué falta | Impacto |
|---|---|---|
| 1 | Fecha de los 4 pagos de adquisición del lote `#00` | $10.425.849,70 fuera de la carga. Hipótesis en `docs/02`, §9 |
| 2 | Período de 4 facturas `Escrow and Legal Fees` de PV2 | $31.799,75 |
| 3 | ¿La numeración buena es la del LEDGER o la del tab de wires? | Desfase de 1 desde diciembre 2025 |
| 4 | `#07` tiene el año mal (dice 2026, el wire es de 2025) | 1 desembolso |
| 5 | Bruto enviado de cada wire (columna *Amount SENT*, hoy vacía) | Sin esto no se concilia la comisión bancaria |
| 6 | Reasignar categoría/fase de las líneas marcadas | Ver `entregables/` |

---

---

## Seguimiento desde el celular (Remote Control)

Para no quedarse esperando en el escritorio durante las corridas largas.

La sesión **sigue corriendo en tu máquina**: filesystem, `CLAUDE.md`, MCP y Postgres quedan locales. El teléfono es sólo una ventana hacia esa sesión.

### Arrancar

Desde la carpeta del proyecto:

```bash
claude remote-control                      # modo servidor; barra espaciadora = mostrar/ocultar QR
claude --remote-control "Dashboard Ventanas"   # interactivo + remoto a la vez
```

Y si ya estás a mitad de una sesión y hay que salir:

```
/remote-control
```

Conserva el historial de la conversación.

### Notificaciones push — el paso que importa

Dentro de Claude Code:

```
/config
```

Activar:
- **Push when Claude decides** → avisa cuando termina una tarea larga
- **Push when actions required** → avisa cuando necesita una decisión

También se puede pedir en el prompt: *"avisame cuando terminen las pruebas"*.

Requiere tener la app instalada, sesión iniciada con la misma cuenta, y permisos de notificación aceptados en el sistema operativo. Si `/config` dice **No mobile registered**, abrir la app en el teléfono para que refresque su token.

Sin la app todavía: `/mobile` muestra el QR de descarga.

### Conectarse

- Escanear el QR con la app
- Abrir la URL de sesión en cualquier navegador
- Buscar la sesión por nombre en la pestaña **Code** de la app o en claude.ai/code

Las sesiones activas aparecen con un ícono de computadora y punto verde.

### Requisitos

- Planes Pro, Max, Team o Enterprise. **No funciona con API key** — hay que estar autenticado con `/login` contra claude.ai
- Correr `claude` una vez en la carpeta del proyecto para aceptar la confianza del workspace
- En Team y Enterprise, un Owner debe habilitarlo primero

### Límites a tener presentes

- **Si se cierra la terminal, la sesión muere.** El proceso local tiene que seguir vivo
- Si la laptop se duerme o se cae la red, reconecta sola al volver
- Máquina despierta pero sin red más de ~10 minutos: la sesión expira y hay que relanzarla
- Es *research preview*: funciona, pero puede tener asperezas. No dejarlo como única vía en un día crítico

### Sobre los datos

Claude Code sólo hace peticiones HTTPS **salientes**; nunca abre puertos entrantes.

Mientras Remote Control está conectado, **la transcripción de la sesión se guarda en servidores de Anthropic** para mantener la sincronía entre dispositivos. La ejecución y el acceso a archivos siguen siendo locales, pero la conversación no.

Para este proyecto: sin problema para código y estructura. Evitar pegar en el chat números de cuenta, IBAN de beneficiarios o contenido de instrucciones de transferencia.

Documentación: https://code.claude.com/docs/en/remote-control

---

## Por dónde seguir

Camino mínimo para dejar el Excel: **fase 2 → 3 → 4 → 5 → 8** (ver `docs/02`).

La siguiente es la **fase 3**: migraciones Alembic + API FastAPI + auth. Todo lo que necesita ya está en `db/schema_v2.sql`.
