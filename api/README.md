# API — DASHBOARD VENTANAS (Fase 3)

FastAPI + SQLAlchemy 2.0 + Alembic. Estructura `routers/ → services/ → repositories/`
(§6 DECISIONES). Los reportes se sirven con SQL crudo contra las vistas `v_*`.

## Estructura

```
api/
├─ app/
│  ├─ core/        config, db (set_config app.user_id), security (JWT), oidc, permissions, problems (RFC 7807), logging
│  ├─ models/      ORM 2.0 (Mapped[]) de las tablas que la Fase 3 escribe
│  ├─ schemas/     Pydantic v2 (contratos)
│  ├─ repositories/  acceso a datos
│  ├─ services/    lógica de negocio (traduce errores de triggers a problem+json)
│  ├─ routers/     health, auth, catálogos, wbs, ledger, reportes
│  ├─ deps.py      sesión por request + usuario autenticado
│  └─ main.py
├─ alembic/        0001 baseline (= db/schema_v2.sql) · 0002 seed de accesos
└─ tests/          pytest (los que tocan BD se saltan sin Postgres)
```

## Puesta en marcha

```bash
cd api
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements-dev.txt
copy .env.example .env          # y editar DATABASE_URL + JWT_SECRET

# La base de desarrollo (crear una vez):
#   createdb -p 5433 dashboard_ventanas    (o CREATE DATABASE con un rol CREATEDB)

alembic upgrade head            # aplica schema_v2.sql + seed de accesos
psql "$DATABASE_URL" -f ../db/test_suite.sql   # debe dar 78/78

uvicorn app.main:app --reload   # http://localhost:8000/docs
```

## Autenticación

- **Producción:** OIDC contra Microsoft 365 (`/api/auth/login` → Azure → `/api/auth/callback`).
  El email de Azure tiene que coincidir con un `app_user` activo. Se activa con
  `OIDC_ENABLED=true` + client id/secret del tenant (lo registra el dueño).
- **Desarrollo:** `POST /api/auth/dev-login {"username": "bismark"}` — sin contraseña,
  sólo con `ENV=dev`. Deshabilitado en prod.

La sesión es un JWT en cookie `httponly` (8 h).

## Permisos

Se leen de `role_permission` (sin permisos en código). `bank.view` y `disb.approve`
son permisos separados a propósito. Mapeo inicial en la migración `0002`; es dato
editable con `UPDATE`.

## Endpoints (Fase 3)

| Método | Ruta | Permiso |
|---|---|---|
| GET/POST/PATCH | `/api/categories` · `/api/phases` | lectura: auth · escritura: `wbs.edit` |
| GET | `/api/meta/task-states` · `/api/meta/line-types` | auth |
| GET | `/api/wbs` · `/api/wbs/{id}` · `/api/wbs/financials` | auth |
| POST/PATCH | `/api/wbs` · `/api/wbs/{id}` | `wbs.edit` |
| PUT | `/api/wbs/{id}/assignment` (reasignar categoría/fase) | `wbs.edit` |
| GET/POST/PATCH | `/api/ledger` | lectura: auth · escritura: `ledger.edit` |
| GET | `/api/reports` · `/api/reports/{nombre}` | `report.view` |

## Calidad

```bash
ruff check app tests alembic && ruff format --check app tests
mypy app
pytest -q
```
