# Runbook — traspaso del proyecto a finance@thecostaricacollection.com

Objetivo: que `finance@thecostaricacollection.com` sea la titular del proyecto Ventanas,
en Railway y en GitHub. Escrito el 2026-08-20 sobre el estado real que describe
`docs/06_INVENTARIO.md`.

## Punto de partida

| Pieza | Titular hoy |
|---|---|
| Repo `ITCRC1/Ventanas` | cuenta **personal** de GitHub `ITCRC1` (no es una organización) |
| Credencial de escritura en uso | `Bismark1973`, que es **colaborador**, no dueño |
| Workspace Railway "Proyectos TCRC" (Pro, 10 proyectos) | sesión `brodriguez7301@gmail.com` |
| Proyecto Railway `Ventanas` | dentro de ese workspace |

## Lo que Railway sí y no permite

De la documentación de Railway:

- **No existe** "transferir el workspace". Los roles de workspace son **Admin**,
  **Member** y **Deployer**; Admin es "full administration of the Workspace and all
  Workspace projects". Se invita desde *Settings → People*.
- El traspaso es **por proyecto**, y en dos formas:
  - **a otro usuario**: agregarlo como miembro del proyecto, los tres puntos junto a su
    nombre → *Transfer Ownership*. Tiene **24 horas** para aceptar por correo.
    Requisito: **ambas partes con plan Hobby o Pro activo**.
  - **a otro workspace**: *Settings del proyecto → Transfer Project*. Hay que ser Admin
    del proyecto y el **workspace destino necesita Hobby o Pro activo**.

Consecuencia práctica: mover los 10 proyectos a un workspace de `finance@` implica
**una segunda suscripción paga** y partir la facturación. Dejar el workspace donde está y
darle a `finance@` rol **Admin** da el mismo control efectivo, sin costo nuevo ni
interrupción. Ese es el camino recomendado; los pasos del traspaso completo quedan igual
documentados abajo por si la decisión es esa.

## Orden de ejecución

### Paso 0 — cuentas (sólo lo puede hacer el usuario)

Crear las cuentas y pagar no lo puede hacer Claude.

1. Cuenta de **GitHub** con `finance@thecostaricacollection.com`.
2. Cuenta de **Railway** con `finance@thecostaricacollection.com`, con plan **Hobby o
   Pro activo** — sin eso, Railway rechaza el traspaso.

Anotar los dos usuarios resultantes en `docs/06_INVENTARIO.md`.

### Paso 1 — Railway, acceso inmediato (sin riesgo)

*Settings → People* del workspace "Proyectos TCRC" → invitar
`finance@thecostaricacollection.com` con rol **Admin**. Aceptar desde el correo.

Con esto ya administra los 10 proyectos, incluido `Ventanas`. Nada se reinicia.

### Paso 2 — Railway, traspaso de titularidad (opcional, cambia facturación)

Sólo si se quiere la titularidad y no sólo el control, y sólo con el plan pago de
`finance@` ya activo:

- Por proyecto: agregar a `finance@` como miembro del proyecto → tres puntos →
  *Transfer Ownership* → aceptar dentro de 24 h. Repetir por cada proyecto que se quiera
  mover.
- O crear el workspace de `finance@` y usar *Transfer Project* desde cada proyecto.

Empezar por un proyecto chico (`Descarga Diaria` o `Tickets`), verificar que siga
desplegando, y sólo después mover `Ventanas`.

### Paso 3 — GitHub, traspaso del repo (requiere ventana de mantenimiento)

`ITCRC1` es una cuenta personal, así que el traspaso lo inicia **quien tenga la sesión de
`ITCRC1`** — no sirve la credencial de `Bismark1973`, que es colaborador:

*Repo → Settings → Danger Zone → Transfer* → destino: el usuario GitHub de `finance@`.
El destino debe aceptar la invitación.

**Riesgo real, no saltearlo:** los servicios `Ventanas Backend` y `Ventanas Frontend`
despliegan desde `ITCRC1/Ventanas` a través de la GitHub App instalada en la cuenta
`ITCRC1`. Después del traspaso GitHub deja una redirección para los `git push`, pero la
autorización de la App queda en la cuenta vieja: **el auto-deploy se corta hasta
reconectar cada servicio** al repo bajo el nuevo dueño.

Secuencia segura:

1. Confirmar que `origin/main` y lo que está vivo en Railway coinciden
   (`git log origin/main` contra el último deploy). Hubo despliegues por `railway up` que
   quedaron adelante de `main`.
2. Transferir el repo y aceptar desde la cuenta destino.
3. En Railway, para cada uno de los dos servicios: reconectar el origen al repo bajo el
   nuevo dueño y autorizar la GitHub App en esa cuenta.
4. Commit de prueba en `main` y verificar que dispara deploy en los dos servicios.
5. Actualizar la credencial local: `cmdkey /delete:git:https://github.com` y volver a
   autenticar en el primer `git push`.
6. Actualizar `docs/06_INVENTARIO.md` con el nombre nuevo del repo.

### Paso 4 — cerrar

- Revisar el duplicado `dashboard-ventanas` del workspace personal antes de que quede
  huérfano (`docs/06_INVENTARIO.md`, §6).
- Rotar lo que estaba atado a las cuentas viejas: variables de Railway con tokens,
  `JWT_SECRET`, credenciales de IMAP de Invoice Receipts.

## Qué no puede hacer Claude

Crear cuentas, escribir contraseñas, pagar suscripciones y aceptar los traspasos —
cada aceptación exige estar dentro de la cuenta destino. Los pasos que son sólo clics
(invitar en Railway, reconectar los servicios) se pueden hacer con el navegador ya
logueado, confirmando antes de cada acción irreversible.
