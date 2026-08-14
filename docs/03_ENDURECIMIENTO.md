# Endurecimiento (Fase 11) — estado

Cinco cosas del plan (§4 "Para que no tenga limitaciones"). Lo que es **código** ya
está hecho y desplegado; lo que es **infraestructura** lo activa el dueño en Railway.

## ✅ Hecho en la aplicación (commit Fase 11)

| # | Qué | Cómo |
|---|---|---|
| 1 | **Auditoría inmutable** | Trigger `trg_audit_log_immutable`: `audit_log` es append-only, rechaza UPDATE/DELETE para cualquier rol (migración `0004`). Verificado: `DELETE FROM audit_log` → error. |
| 2 | **Doble aprobación** | Desembolsos > **USD 25.000** (`DISB_APPROVAL_THRESHOLD`) exigen **dos aprobadores distintos**. Tabla `disbursement_approval` (UNIQUE por usuario), lógica en `services/disbursement.approve`. El mismo usuario no puede aprobar dos veces (409). |
| 3 | **Rate limiting del login** | Middleware `SecurityMiddleware`: máx. `LOGIN_RATE_LIMIT` (10) intentos por `LOGIN_RATE_WINDOW_S` (60s) por IP sobre `/api/auth/*login`. Excedido → 429. Frena fuerza bruta sobre la contraseña compartida. |
| 4 | **Security headers** | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Strict-Transport-Security` en toda respuesta. |

## ⚙️ Pendiente de infraestructura (lo activa el dueño en Railway)

| # | Qué | Cómo |
|---|---|---|
| 5a | **Backups con PITR** | Railway Postgres (plan de pago) tiene backups automáticos. Para *point-in-time recovery* real: activar backups en el servicio Postgres del proyecto `dashboard-ventanas`, o migrar a un Postgres gestionado con WAL archiving (Neon/Supabase/RDS). `pg_dump` diario **no alcanza** para datos financieros. |
| 5b | **Cifrado en reposo** | Cifrado a nivel de disco del volumen de Postgres (lo provee el proveedor). Los IBAN y los PDFs de instrucción son sensibles. Railway cifra el almacenamiento; confirmar en la config del servicio. |
| 5c | **Rol de app sin acceso de escritura a la auditoría** | Complemento del punto 1: crear un rol `ventanas_app` (no dueño de las tablas) con `SELECT/INSERT/UPDATE/DELETE` en todo **excepto** solo `SELECT/INSERT` en `audit_log`, y conectar la app con ese rol. Hoy el trigger ya bloquea el UPDATE/DELETE aunque la app conecte como dueño; el rol es defensa en profundidad. |

## Otras decisiones de acceso pendientes del dueño

- **OIDC Microsoft 365** (§9.4): registrar la app en Azure AD, setear `OIDC_ENABLED` + client id/secret en Railway, y mapear los emails del equipo a los `app_user`. Reemplaza la contraseña compartida.
- **Umbral de doble aprobación**: ajustable con la variable `DISB_APPROVAL_THRESHOLD` en Railway (default 25000). Nota: con la contraseña compartida todos entran como el mismo usuario, así que la doble aprobación real requiere OIDC con usuarios distintos.
