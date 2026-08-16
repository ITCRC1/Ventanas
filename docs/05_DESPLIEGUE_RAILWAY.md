# Despliegue en Railway — DASHBOARD VENTANAS

Guía operativa. El repo ya viene preparado: Dockerfiles, `railway.json` y variables
de entorno documentadas. Lo que queda es crear el proyecto y pegar las variables.

> **Esto cuesta plata** (DECISIONES §9.5). El plan de Railway y el `railway up`
> los corrés vos. Acá no se contrata ni se despliega nada por tu cuenta.

---

## 1. La forma del despliegue

Tres servicios en un mismo proyecto de Railway:

```
                    Internet
                       │  https://ventanas.up.railway.app
                       ▼
              ┌─────────────────┐
              │   web  (Next)   │   ← único servicio con dominio público
              │  Root Dir: web  │
              └────────┬────────┘
                       │  /api/*  →  red privada IPv6
                       ▼
              ┌─────────────────┐
              │  api  (FastAPI) │   ← SIN dominio público
              │  Root Dir:  /   │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │    Postgres     │   ← plugin de Railway
              └─────────────────┘
```

**Por qué la API no se publica.** El front ya reenvía `/api/*` al backend
(`next.config.mjs`). Con eso la cookie de sesión viaja same-origin —sin CORS, sin
`SameSite=None`— y los IBAN de beneficiarios nunca quedan en un host alcanzable
desde afuera. Efecto colateral: `/docs` (Swagger) tampoco es público. Para verlo,
`railway run` o abrí un dominio temporal y cerralo después.

**Por qué la API se construye desde la raíz del repo.** La migración `0001` ejecuta
`db/schema_v2.sql` tal cual (§1 DECISIONES). Ese archivo vive fuera de `api/`, así
que el contexto de build tiene que ser la raíz. `api/Dockerfile` reproduce la
disposición del repo dentro de la imagen (`/srv/api`, `/srv/db`).

---

## 2. Crear el proyecto

```bash
npm i -g @railway/cli
railway login
railway init            # dentro de la carpeta del repo
```

O desde la web: **New Project → Deploy from GitHub repo**.

### Postgres

**New → Database → Add PostgreSQL.** Anotá el nombre del servicio (por defecto
`Postgres`), que se usa en la referencia de variables.

> Railway sirve PostgreSQL 16+, que es lo que pide `schema_v2.sql`. Verificalo con
> `SELECT version();` antes de la primera migración.

### Servicio `api`

| Ajuste | Valor |
|---|---|
| Nombre del servicio | **`api`** (exacto: el front lo resuelve por ese nombre) |
| Root Directory | *(vacío — la raíz del repo)* |
| Config as code | `railway.json` |
| Builder | Dockerfile (ya lo dice `railway.json`) |
| Public Networking | **sin dominio** |

### Servicio `web`

| Ajuste | Valor |
|---|---|
| Nombre del servicio | `web` |
| Root Directory | **`web`** |
| Config as code | `railway.json` *(relativo al root dir → `web/railway.json`)* |
| Public Networking | **Generate Domain** |

---

## 3. Variables

### `api`

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
ENV=prod
PORT=8080
WEB_CONCURRENCY=2

JWT_SECRET=<64 caracteres al azar — ver abajo>

WEB_BASE_URL=https://<dominio-del-servicio-web>
CORS_ORIGINS=["https://<dominio-del-servicio-web>"]
```

Generar el secreto (PowerShell):

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

`COOKIE_SECURE` no hace falta: con `ENV=prod` la app la fuerza a `true`.
`DEV_LOGIN_ENABLED` tampoco: `/api/auth/dev-login` devuelve 404 en prod.

**Primer acceso.** La migración `0002` crea los cinco usuarios **sin correo y sin
contraseña**, y en prod `dev-login` devuelve 404. O sea: recién desplegado no hay
por dónde entrar. Dos salidas:

```powershell
# a) RECOMENDADO — crear el acceso real, sin redesplegar.
#    Necesita el DATABASE_PUBLIC_URL del plugin (forma postgresql://, sin +psycopg).
$env:DATABASE_URL = "postgresql://...@...proxy.rlwy.net:PUERTO/railway"
python etl/set_password.py bismark --email fc@empresa.com
```

```bash
# b) portón de contraseña compartida (demo). Entra como SHARED_LOGIN_USER.
SHARED_PASSWORD=<clave larga>
SHARED_LOGIN_USER=bismark
```

Con (a) entrás como `bismark`, que es `controller` y tiene `admin.users`: desde
`/admin` cargás correo y contraseña de los otros cuatro. `set_password.py` es
también la salida si alguien queda afuera.

**OIDC Microsoft 365**, cuando el dueño del tenant registre la app:

```bash
OIDC_ENABLED=true
OIDC_TENANT_ID=<tenant>
OIDC_CLIENT_ID=<client id>
OIDC_CLIENT_SECRET=<client secret>
OIDC_REDIRECT_URI=https://<dominio-del-servicio-web>/api/auth/callback
```

El *redirect URI* apunta al dominio del **front**, no al de la API: el front
reenvía `/api/*`. Ese mismo valor va registrado en Azure.

**Bandeja de facturas por correo** (opcional; vacío = dormida):

```bash
INVOICE_IMAP_USER=<buzón>
INVOICE_IMAP_PASSWORD=<App Password de Gmail, no la clave del correo>
INVOICE_SYNC_INTERVAL_MIN=15
```

### `web`

```bash
API_PROXY_TARGET=http://api.railway.internal:8080
PORT=8080
```

> `API_PROXY_TARGET` se lee **en cada pedido**, en `web/app/api/[...path]/route.ts`.
> Cambiarla sólo necesita reiniciar el servicio, no reconstruir. El default asume
> que el servicio de la API se llama `api`; si le pusiste otro nombre, ajustá el
> host acá.
>
> Cuando el reenvío falla, el front devuelve `502` con el motivo real en el cuerpo
> (`ENOTFOUND` = el nombre no existe · `ECONNREFUSED` = el puerto no es ése), en vez
> de un 500 mudo. Es la forma rápida de diagnosticar el enlace entre servicios.

---

## 4. Primer despliegue

```bash
railway up          # o push a main si conectaste el repo de GitHub
```

El contenedor de la API corre `alembic upgrade head` antes de levantar gunicorn.
En una base vacía eso aplica la baseline (38 tablas, 22 vistas) y las 46
migraciones siguientes. Mirá los logs: tiene que aparecer el `upgrade` y después
el arranque de gunicorn.

### Comprobaciones

```bash
railway logs -s api

# desde el navegador, contra el dominio del front:
#   https://<dominio>/api/health       -> {"status":"ok"}
#   https://<dominio>/api/health/db    -> {"status":"ok","public_tables":NN}
#   https://<dominio>/login            -> pantalla de acceso
```

Si `/api/health` responde y `/api/health/db` no, el problema es la base. Si
ninguno responde pero `/login` sí, el problema es el proxy: revisá
`API_PROXY_TARGET` y que la API esté escuchando (§6).

### Correr la suite de pruebas del esquema

```bash
railway run --service api psql $DATABASE_URL -f ../db/test_suite.sql   # 78/78
```

---

## 5. Cargar los datos

La base de Railway nace vacía. Alembic le pone el esquema, los catálogos, los 5
usuarios y la plantilla de instrucción — **ninguna cifra**. Los datos entran con
el ETL, que corre **desde tu máquina**: lee los `.xlsm` y `.xls` locales, que a
propósito no están en la imagen.

**Orden:** primero el deploy (que corre `alembic upgrade head` y crea las tablas),
después el ETL. Al revés no funciona: los importadores insertan, no crean.

### La trampa de la URL

Hay **dos formas** de la cadena de conexión y no son intercambiables:

| Quién | Forma | Por qué |
|---|---|---|
| La API | `postgresql+psycopg://…` | SQLAlchemy necesita el dialecto explícito |
| **El ETL** | `postgresql://…` | usa `psycopg.connect()` directo, que es libpq puro y **rechaza el `+psycopg`** |

Para el ETL copiá el **`DATABASE_PUBLIC_URL`** del plugin de Postgres tal cual
(hay que habilitarle el proxy TCP público en *Connect → Public Network*). Si le
pegás la del servicio `api`, falla en la conexión.

```powershell
$env:DATABASE_URL = "postgresql://postgres:CLAVE@HOST.proxy.rlwy.net:PUERTO/railway"
```

### Los cinco importadores

| Script | Qué carga | Insumo |
|---|---|---|
| `load.py --sqlite data/2026-08/ventanas.db --reconcile` | WBS, presupuesto, ledger, cronograma, bancos, wires, auditoría | **ya está en el repo** |
| `import_short_payments.py --xlsx <archivo>` | `payee`, `disbursement`, `disbursement_line` | Short Payments (.xlsx) |
| `import_ledger_sheet.py <xlsm>` | `ledger_sheet_row` | master file original |
| `import_us_wires.py <xlsm>` | `us_wire_row` | master file original |
| `import_lafise.py <archivo>` | `bank_tx` | estado de cuenta LAFISE (.xls o PDF) |

Sólo el primero corre con lo que hay en el repo; los otros cuatro necesitan los
archivos originales, que **no** están versionados. Todos son idempotentes: se
pueden repetir sin duplicar (§6 DECISIONES).

`--reconcile` compara contra el propio Excel y dice CUADRA o NO CUADRA. Nunca
inventa datos: lo que no puede resolver lo reporta.

`import_short_payments.py` acepta `--mask-iban` para cargar sin los IBAN de
beneficiarios.

### Lo que ningún ETL reconstruye

Todo lo que se carga trabajando dentro de la app: facturas y su bandeja de correo
(`invoice`, `invoice_receipt`, con los PDF/XML en `bytea`), planning y sus enlaces
compartidos, conciliación bancaria, `credit_application`, `wire_fee`,
`fund_movement`, aprobaciones de desembolsos y contraseñas. Eso se rehace a mano
o se trae con `pg_dump` desde otra base — no hay importador.

> Cargar producción es DECISIONES §9.2: lo corrés vos, no Claude Code.

---

## 5-bis. Cerrar el acceso — checklist

Orden pensado para no quedarte afuera en el camino. **Nunca cierres una puerta
antes de haber probado la siguiente.**

### Antes de que entren datos reales

| # | Qué | Dónde | Por qué |
|---|---|---|---|
| 1 | `ENV=prod` | Variables del backend | Sin esto `/api/auth/dev-login` está vivo: cualquiera entra como Financial Controller **sin contraseña** |
| 2 | `JWT_SECRET` de 48+ caracteres | Variables del backend | Con una clave corta el token de sesión es forzable. Cierra las sesiones abiertas |
| 3 | Probar `https://<front>/api/health` | navegador | Confirma que el front llega al backend **antes** del paso 4 |
| 4 | Quitarle el dominio público al backend | Settings → Networking | El front ya reenvía `/api/*`. Deja de exponer la API y `/docs` a internet |
| 5 | Apagar Public Access de Postgres | Postgres → Settings → Networking | Es lo único que hace alcanzable la base desde afuera. Prendelo sólo para correr el ETL |
| 6 | Cambiar la clave de `bismark` desde `/admin` y borrar `clave_inicial.txt` | app | La clave de arranque es temporal por diseño |
| 7 | MFA en las cuentas de Railway y GitHub | proveedores | Quien entra ahí despliega lo que quiera: es otra puerta al mismo sistema |

### Cuando se pueda

| # | Qué | Por qué |
|---|---|---|
| 8 | **OIDC contra Microsoft 365** (§2 DECISIONES) | Es la respuesta de fondo: se acaban las contraseñas de la app, el MFA y las bajas las maneja el tenant. Necesita que el dueño registre la app en Azure |
| 9 | Credenciales propias para los otros cuatro, desde `/admin` | Una clave por persona. Nada de cuenta compartida: sin eso la auditoría no dice quién hizo qué |
| 10 | Rotar la contraseña de Postgres | Con el paso 5 hecho deja de ser urgente, pero conviene si el string circuló |

### Sobre rotar la contraseña de Postgres

No alcanza con cambiar la variable: `POSTGRES_PASSWORD` sólo se usa al inicializar
el volumen. Son dos pasos y hay que hacer los dos, o el backend queda sin conectar:

1. Postgres → pestaña **Console**: `ALTER USER postgres WITH PASSWORD 'nueva-larga';`
2. Postgres → **Variables**: actualizá `POSTGRES_PASSWORD` para que `DATABASE_URL`
   se recomponga, y esperá el redespliegue del backend.

### Lo que ya está cubierto por el diseño

- La cookie de sesión es `httponly` + `secure` (con `ENV=prod`) + `samesite=lax`, 8 h.
- Las contraseñas van con hash **bcrypt**; nunca en claro, ni en la base ni en los logs.
- Los permisos se leen de `role_permission`, no del código: `bank.view` (ver IBAN) y
  `disb.approve` (aprobar plata) son permisos **distintos** a propósito.
- Rate limit del login por IP, con `X-Forwarded-For` real gracias a `--forwarded-allow-ips`.
- Security headers (`nosniff`, `X-Frame-Options: DENY`, HSTS) en todas las respuestas.
- La app no escribe archivos: los PDF y XML viven en Postgres, no en el disco del contenedor.

---

## 6. Trampas que ya están resueltas (no las deshagas)

| Trampa | Cómo quedó |
|---|---|
| La red privada de Railway es **IPv6**. `gunicorn -b 0.0.0.0` no es alcanzable desde el front | El Dockerfile bindea `[::]`. En Linux (`bindv6only=0`) ese socket atiende igual el healthcheck IPv4 |
| Next hornea los rewrites **al construir**: el destino del proxy quedaba fijo en `routes-manifest.json` y cada corrección costaba una reconstrucción entera | Se cambió el rewrite por `web/app/api/[...path]/route.ts`, que lee `API_PROXY_TARGET` en cada pedido y devuelve el error real (`ENOTFOUND` / `ECONNREFUSED`) en vez de un 500 mudo |
| La migración `0001` lee `db/schema_v2.sql`, que está fuera de `api/` | El contexto de build es la raíz del repo; la imagen conserva `/srv/api` + `/srv/db` |
| Railway entrega `DATABASE_URL` como `postgresql://…` y SQLAlchemy sin sufijo busca psycopg2, que no está instalado | `config.py` reescribe a `postgresql+psycopg://` |
| Detrás del proxy, `request.client.host` es la IP del proxy y el rate limit del login sería un solo balde para todos | gunicorn corre con `--forwarded-allow-ips '*'` |
| Con 2 workers, **cada uno** arranca su hilo de auto-sync del buzón y se pisan la marca de UID | `pg_try_advisory_xact_lock` en `invoice_scheduler._sync_once` |
| La cookie de sesión sin `secure` sobre HTTPS | `ENV=prod` la fuerza a `true` en `config.py` |

---

## 7. Respaldos

`DECISIONES.md` §5 pide **PITR con WAL archiving**; `pg_dump` diario no alcanza.
El plugin de Postgres de Railway hace snapshots, no PITR. Dos caminos:

1. Activar backups del plugin y aceptar la granularidad del snapshot.
2. Postgres administrado con PITR (Neon, Crunchy, RDS) y apuntar `DATABASE_URL` ahí.

**Es una decisión tuya** (§9.5, gasto). Hasta que se resuelva, el despliegue queda
con el respaldo que dé el plugin — que no cumple lo que dice DECISIONES.

---

## 8. Lo que quedó fuera a propósito

- **Sin staging** (§5): un solo entorno `prod` además del local.
- **Sin CDN ni almacenamiento de objetos**: los PDF y XML de facturas viven en
  Postgres (`bytea`). La app no escribe un solo archivo a disco, así que el
  contenedor es descartable.
- **Sin Redis ni Celery** (§2): las tareas de fondo son hilos con candado en la base.
