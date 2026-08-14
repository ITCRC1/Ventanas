# DECISIONES PREAPROBADAS — DASHBOARD VENTANAS

Aprobado por el Financial Controller el 24-07-2026.

**Regla de oro:** todo lo que esté en este documento **ya está aprobado**. Claude Code lo usa sin preguntar. Preguntar por algo que está acá es hacer perder tiempo.

Sólo se consulta lo que aparece en la sección **§9 — Lo único que sigue requiriendo decisión**.

---

## 1. Base de datos

| Decisión | Aprobado |
|---|---|
| Motor | **PostgreSQL 16+** |
| Nombre de la BD | `dashboard_ventanas` |
| Migraciones | **Alembic**, una migración por cambio, nunca editar una ya aplicada |
| Driver | **psycopg 3** (`psycopg[binary]`) |
| ORM | **SQLAlchemy 2.0**, estilo declarativo con `Mapped[]` |
| Consultas de reporte | **SQL crudo** contra las vistas. Sin ORM |
| Montos | `numeric(16,2)`. **Float está prohibido** |
| Extensiones | `pg_trgm` y `unaccent` si hacen falta para búsqueda |

La primera migración de Alembic reproduce `db/schema_v2.sql` tal cual. No rediseñar el modelo: ya está validado con 78 pruebas.

## 2. Backend

| Decisión | Aprobado |
|---|---|
| Framework | **FastAPI** |
| Servidor | **uvicorn** (dev) · **gunicorn + uvicorn workers** (prod) |
| Validación | **Pydantic v2** |
| Auth | **OIDC contra Microsoft 365** (`authlib`) |
| Sesión | **JWT** en cookie `httponly` + `secure` + `samesite=lax`, expiración 8 h |
| Permisos | Dependencia FastAPI que lee `role_permission`. Sin permisos en código |
| Config | **pydantic-settings**, todo por variable de entorno |
| Fecha/hora | `timestamptz` siempre. La app en UTC, el front convierte |
| Logs | **structlog** en JSON |
| Errores | `RFC 7807` (`application/problem+json`) |
| PDF | **WeasyPrint** (HTML + CSS) |
| Excel | **openpyxl** |
| Tareas de fondo | **APScheduler**. Nada de Celery ni Redis para este volumen |

## 3. Frontend

| Decisión | Aprobado |
|---|---|
| Framework | **Next.js 15**, App Router |
| Lenguaje | **TypeScript**, `strict: true` |
| Datos | **TanStack Query v5** |
| Tablas | **TanStack Table v8** + **TanStack Virtual** (obligatorio: 52.000 celdas) |
| Estilos | **Tailwind CSS** |
| Componentes | **shadcn/ui** |
| Íconos | **lucide-react** |
| Gráficos | **Recharts** |
| Formularios | **react-hook-form** + **zod** |
| Fechas | **date-fns** |
| Idioma de la interfaz | **español** |

## 4. Calidad y pruebas

| Decisión | Aprobado |
|---|---|
| Formato Python | **ruff format** |
| Lint Python | **ruff** |
| Tipos Python | **mypy**, modo `strict` en `app/` |
| Pruebas Python | **pytest** + **pytest-asyncio** |
| Pruebas de BD | `db/test_suite.sql` — debe dar 78/78 siempre |
| Cobertura mínima | 70 % en la capa de servicios. No perseguir 100 % |
| Formato/lint front | **biome** |
| Pruebas front | **vitest** + **testing-library** |
| Hooks de commit | **pre-commit** con ruff, biome y detección de secretos |

## 5. Infraestructura

| Decisión | Aprobado |
|---|---|
| Repo | **Git**, monorepo: `api/`, `web/`, `db/`, `etl/` |
| Ramas | `main` protegida + ramas de trabajo. Sin gitflow |
| CI | **GitHub Actions**: lint, mypy, pytest, `test_suite.sql` |
| Contenedores | **Docker Compose** para desarrollo (Postgres + API + web) |
| Entornos | `dev` (local) y `prod`. **Sin staging** — no lo amerita |
| Backups | **PITR con WAL archiving.** `pg_dump` diario no alcanza |
| Secretos | `.env` local · variables del proveedor en prod. **Nunca en el repo** |

## 6. Patrones de código

Todo esto está aprobado. Aplicar sin consultar.

- **Estructura de la API:** `routers/` → `services/` → `repositories/`. La lógica va en `services`.
- **Transacciones:** una por request, con dependencia de FastAPI.
- **Usuario de auditoría:** `SELECT set_config('app.user_id', ..., false)` al abrir cada transacción. Sin excepciones.
- **Paginación:** `limit`/`offset` con tope de 500. Cursor sólo si hace falta.
- **Nombres:** tablas y columnas en inglés, snake_case, singular. Endpoints en inglés, kebab-case.
- **Comentarios y mensajes de error:** en español.
- **Idempotencia:** todo importador debe poder correrse dos veces sin duplicar.
- **Nada de soft-delete.** Anular con estado + auditoría.
- **Cero lógica de negocio en el front.** Los totales vienen de la base.

## 7. Qué puede hacer Claude Code sin preguntar

- Crear, mover, renombrar y borrar archivos del repo
- Instalar cualquier dependencia de las secciones §1 a §4
- Instalar una dependencia **no listada** si es de uso común, tiene licencia permisiva (MIT, Apache-2.0, BSD) y resuelve algo del alcance. Anotarla en el commit
- Escribir y correr migraciones de Alembic en desarrollo
- Crear, borrar y recargar la base de **desarrollo** las veces que haga falta
- Escribir y modificar pruebas
- Refactorizar, renombrar, reorganizar
- Elegir nombres de variables, funciones, componentes y endpoints
- Decidir la disposición visual y de interacción de las pantallas
- Correr el ETL contra archivos de ejemplo
- Hacer commits y abrir ramas

## 8. Checkpoints — avisar, no pedir permiso

Al terminar cada fase, dejar un resumen de una página: qué quedó, qué decisiones se tomaron, qué falta. **No esperar respuesta para seguir con la fase siguiente**, salvo que toque algo de §9.

## 9. Lo único que sigue requiriendo decisión

Corta a propósito. Estas cinco no se pueden preaprobar sin que deje de ser serio.

1. **Reglas de negocio que sólo vos conocés.** Fechas del lote `#00`, cuál numeración de desembolso es la buena, período de las facturas legales de PV2, umbrales de aprobación. Claude Code **pregunta y no adivina** — pero mientras tanto sigue con lo demás en vez de bloquearse.

2. **Cualquier cosa contra la base de producción.** Migraciones, cargas, correcciones de datos. Desarrollo es libre; producción la corrés vos.

3. **Cambios al modelo de datos ya validado.** Agregar tablas y columnas es libre. Cambiar el significado de algo existente —`disb_no`, cómo se calcula el gasto, qué es un crédito— no.

4. **Publicar o enviar algo hacia afuera.** Mandar un correo, generar una instrucción de transferencia real, subir algo a un servicio externo.

5. **Gasto de dinero.** Contratar hosting, un servicio pago, una licencia.

**Todo lo demás está aprobado. Si dudás entre preguntar y avanzar, avanzá.**

---

## 10. Cómo revertir

Cualquier decisión de este documento se puede cambiar. Se edita acá, se anota la fecha y el motivo, y sigue.

Lo que **no** se hace es discutir la decisión cada vez que aparece en el camino. Para eso se escribió.

| Fecha | Cambio | Motivo |
|---|---|---|
| 2026-07-24 | Versión inicial | — |
