# Contexto del proyecto — DASHBOARD VENTANAS

Leé este archivo y después **`DECISIONES.md`** antes de tocar nada.

**El stack, las librerías y los patrones ya están decididos y aprobados** en `DECISIONES.md`. No hay que consultarlos. Sólo se pregunta lo que aparece en su §9: reglas de negocio que sólo el usuario conoce, acciones contra producción, cambios al significado del modelo, envíos hacia afuera y gasto de dinero.

Ante la duda entre preguntar y avanzar: **avanzar**, y dejarlo anotado en el checkpoint.

## Qué es

App de control financiero para el proyecto de inversión **Ventanas** (Costa Rica), que reemplaza un master file Excel de 20 hojas, 12.345 fórmulas y 15 módulos VBA.

**Proyecto único.** No hay multipropiedad, no hay `project_id`. Si aparece la tentación de generalizar a otras propiedades, no.

El usuario es el Financial Controller. Trabaja en Windows. Prefiere ejecución directa sobre discusión, respuestas concisas, y corridas autónomas con checkpoints en vez de aprobación paso a paso.

## Stack

PostgreSQL 16+ · FastAPI + SQLAlchemy 2.0 + Alembic · Next.js 15 + TypeScript + TanStack Query · openpyxl · WeasyPrint · auth OIDC contra Microsoft 365.

Detalle completo con versiones y librerías: `DECISIONES.md` §1 a §4.

## Estado

| | |
|---|---|
| Modelo de datos | terminado — `db/schema_v2.sql`, 38 tablas, 22 vistas |
| Pruebas | 78, todas verdes en base limpia — `db/test_suite.sql` |
| ETL | funcionando de punta a punta contra datos reales |
| API | **no empezada — acá arranca el trabajo** |
| Front | no empezado |

## Reglas de este proyecto

**No inventar datos.** Es un libro contable que va a los dueños del proyecto. Si falta una fecha, un monto o una referencia, se reporta — no se rellena. `load.py` ya funciona así y hay que mantenerlo.

**La lógica de negocio vive en la base.** Totales, saldos y validaciones son triggers y vistas. El front no recalcula nada: si recalcula, tarde o temprano difiere, que es exactamente el problema del Excel actual.

**SQL crudo para las vistas de reporte.** `v_timeline`, `v_credit_ledger`, `v_wire_reconciliation` y compañía se consultan directo. El ORM ahí sólo agrega latencia y opacidad.

**Nada de soft-delete.** Anular con estado (`cancelled`) y auditoría, que ya está modelada.

**Los catálogos son tablas, no enums de código.** Categorías, fases, estados, roles, tipos de comisión, reglas de clasificación bancaria: todo editable sin desplegar.

**Correr `db/test_suite.sql` después de cada cambio al esquema.** Debe dar 78/78. Si agregás tablas o triggers, agregá pruebas.

## Trampas conocidas (cada una costó un bug)

- **Los triggers `BEFORE` disparan en orden alfabético.** Dos triggers sobre la misma tabla se pisan. Por eso `wbs_enforce_category_phase()` es uno solo que limpia y después valida.
- **Un `CHECK` no puede consultar otra tabla.** Nada de números mágicos tipo `state_id = 1`; usar trigger contra `task_state.requires_amount`.
- **`SET app.user_id = %s` no acepta parámetros.** Usar `SELECT set_config('app.user_id', %s, false)`.
- **Las fechas del LEDGER están en formato MM/DD/YYYY** (estadounidense), con excepciones sueltas en DD/MM. `load.py` las desambigua; no simplificar esa lógica.
- **LAFISE le pone a la comisión el mismo número de confirmación que a la transferencia.** Sirve para ligarlas, pero rompe cualquier clave única que sea sólo `(cuenta, fecha, nro)`.
- **El estado de cuenta LAFISE viene del más reciente al más antiguo.** El orden real de asiento es el del archivo invertido.
- Al ordenar `CREATE TABLE`, cuidado con FKs hacia tablas definidas más abajo: van por `ALTER TABLE` al final.

## Convenciones

- Comentarios y mensajes de error **en español**.
- Nombres de tablas y columnas **en inglés**, snake_case, singular (`wbs_item`, no `wbs_items`).
- Montos `numeric(16,2)`. **Nunca float.**
- Fechas de semana siempre lunes (hay un CHECK que lo obliga).
- Los reportes salen dolarizados: usar `amount_usd` / `amount_paid_usd`, no `amount`.

## Ritmo de trabajo

El usuario prefiere corridas autónomas con checkpoints, no aprobación paso a paso. Al terminar una fase: resumen de una página y **seguir con la siguiente sin esperar respuesta**, salvo que toque algo de `DECISIONES.md` §9.

Si una regla de negocio bloquea una parte, preguntarla y **seguir avanzando con el resto** en vez de detenerse.

## Trabajo remoto

El usuario sigue las corridas desde el celular con Remote Control y notificaciones push. Para que eso funcione bien:

- En tareas largas, emitir señales de avance claras: qué se está haciendo y cuánto falta. En el teléfono se lee poco.
- Cuando haga falta una decisión de `DECISIONES.md` §9, formular **una pregunta concreta y contestable desde el celular** (sí/no, o pocas opciones), no un párrafo abierto.
- Después de preguntar, **seguir avanzando con lo que no depende de esa respuesta** en vez de quedarse bloqueado.
- Al terminar una fase, cerrar con el resumen de una página; ese es el momento en que llega la notificación.

## Lo siguiente

**Fase 3:** Alembic + API FastAPI + auth OIDC + permisos por rol.

Los roles y permisos ya están cargados en el esquema (`role`, `permission`, `role_permission`). Los usuarios reales son el Financial Controller, Blake (PM), Corporativo, Administración y Ronald.

`disb.approve` y `bank.view` son permisos **separados** a propósito: ver los IBAN de beneficiarios no es lo mismo que aprobar un desembolso.

Detalle de las fases y qué modelo conviene en cada una: `docs/02_PLAN_FASES_Y_MODELOS.md`.
