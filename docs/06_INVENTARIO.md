# Inventario del proyecto — DASHBOARD VENTANAS

Ficha única de dónde vive cada pieza del proyecto y cómo cargarlo para trabajar.
Verificado el **2026-08-20**.

Titular funcional: **finance@thecostaricacollection.com** (Financial Controller).
Ojo: la cuenta con la que hoy se administra la infraestructura es otra — ver
[Accesos](#accesos) al final.

---

## 1. Código

| | |
|---|---|
| Repositorio | `https://github.com/ITCRC1/Ventanas` (privado) |
| Rama de producción | `main` |
| Credencial con escritura | usuario GitHub **`Bismark1973`** (guardada en Git Credential Manager) |
| Clon local | `C:\dev\Ventanas` |
| Worktrees | `C:\dev\Ventanas\.claude\worktrees\<rama>` |
| `gh` CLI | **no instalado** en esta máquina |

Estructura de carpetas: ver `README.md`.

## 2. Producción — Railway

Workspace **Proyectos TCRC** (plan Pro). Proyecto **Ventanas**,
`a551bffa-cd30-421b-a88a-2a93311f4f0e`, entorno `production`
(`7f54c61f-d8ad-489e-aa19-c04fac6bc4bb`).

| Servicio | Origen | URL |
|---|---|---|
| `Ventanas Frontend` | repo `ITCRC1/Ventanas`, root `web` | https://ventanas.up.railway.app |
| `Ventanas Backend` | repo `ITCRC1/Ventanas` | https://ventanas-backend.up.railway.app |
| `Postgres` | imagen `postgres-ssl:18` | interno |

La raíz del front redirige a `/dashboard`. El front reenvía `/api/*` al backend por
`API_PROXY_TARGET`.

**Los nombres de servicio son esos tres**, no `api` / `web` como dicen el `README.md` y
los `railway.json`. Runbook de despliegue y variables: `docs/05_DESPLIEGUE_RAILWAY.md`.

## 3. Entorno local

| | |
|---|---|
| venv | `C:\dev\Ventanas\.venv` — Python **3.12.10** (producción usa `python:3.12-slim`) |
| Base de desarrollo | `dashboard_ventanas` en el servicio `postgresql-x64-16`, puerto **5432** |
| Migraciones | 47, aplicadas con `alembic upgrade head` |
| Pruebas de esquema | `db/test_suite.sql` → **78/78** |
| API | `uvicorn app.main:app` desde `api/`, puerto **8000** |
| Front | `npm run dev` desde `web/`, puerto **3000** (hay `.claude/launch.json`) |
| Config | `.env`, `api/.env`, `web/.env.local` — creados desde los `.example` |

En dev: `ENV=dev`, `DEV_LOGIN_ENABLED=true`, OIDC apagado.
El `5433` que aparece en `.env.example` **no existe** en esta máquina.

## 4. Respaldos y datos

| Qué | Dónde |
|---|---|
| Respaldo de base | `I:\Mi unidad\PROJECTOS BISMARK\PROYECTO VENTANAS\ventanas_respaldo_base_2026-08-11.zip` |
| Copia de trabajo en Drive | `I:\Mi unidad\PROJECTOS BISMARK\PROYECTO VENTANAS\ventanas\` |
| Extracción vigente del Excel | `data/2026-08/` (269 asientos) |
| Foto anterior | `data/2026-07/` (sólo referencia) |
| Entregables | `entregables/` |
| Master file de origen | `VENTANAS_JOB_COST_REP_2026.xlsm` |

## 5. Cómo cargar el proyecto y ponerse a trabajar

```bash
cd C:\dev\Ventanas
.venv\Scripts\activate
alembic upgrade head
```

Después, en dos terminales: `uvicorn app.main:app --reload` desde `api\`, y
`npm run dev` desde `web\`. Front en http://localhost:3000, API en
http://localhost:8000.

Antes de tocar nada: `CLAUDE.md` y luego `DECISIONES.md`.
Antes de desplegar: comparar `git log origin/main` con lo que está vivo en Railway —
hubo despliegues por `railway up` que quedaron adelante de `main`.

## 6. Accesos

- **Railway** se administra hoy con la sesión de `brodriguez7301@gmail.com`. El workspace
  Proyectos TCRC contiene además: Daily Report Corcovado, Daily Report Amarena,
  Portal-Ventanas, Corcovado-OPS, CRC-OPS-MANUAL, Portal TCRC, Descarga Diaria,
  Sistema de Vouchers y Tickets.
- **GitHub** `ITCRC1/Ventanas` se escribe con la credencial de `Bismark1973`.
- **Duplicado pendiente de decidir**: en el workspace personal
  `brodriguez7301-dot's Projects` sigue vivo el proyecto **`dashboard-ventanas`**
  (`a646900b-8555-41db-ba81-0d088423c542`) con un servicio `backend` en
  `backend-production-b83a.up.railway.app` y su propio `Postgres`. No es el de
  producción. Está online y **no se tocó**.
