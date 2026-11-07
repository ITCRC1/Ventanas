# Correcciones de datos

Scripts de un solo uso contra la base de producción. Cada uno:

* corre dentro de una transacción,
* se **verifica solo** (si el resultado no es el esperado, levanta excepción y
  no borra nada),
* termina en `ROLLBACK`.

Correrlo tal cual **no cambia nada**: muestra qué haría. Para que quede, se
cambia esa última línea por `COMMIT;`.

Quién los corre: el owner. `DECISIONES.md` §9.2 — *«Cualquier cosa contra la
base de producción… producción la corrés vos.»*

## Cómo correrlos en Windows

`psql` viene con PostgreSQL. Si `psql --version` no responde, está instalado
pero fuera del PATH — en esta máquina estaba en
`C:\Program Files\PostgreSQL\15\bin`. Se agrega una vez:

```powershell
[Environment]::SetEnvironmentVariable(
  "Path",
  [Environment]::GetEnvironmentVariable("Path","User") + ";C:\Program Files\PostgreSQL\15\bin",
  "User")
```

### ⚠️ `railway run -- psql …` no sirve

Dos razones, las dos cuestan un rato si no se saben:

1. `railway run` inyecta `PGHOST=postgres.railway.internal`, que solo se
   resuelve **dentro** de la red de Railway. Desde la máquina da
   `Unknown host`.
2. Parte mal los argumentos: `-f archivo.sql` le llega a psql como un
   positional suelto y contesta *«se ignoró argumento extra»*, sin correr nada.

### Lo que sí funciona

Se toma la URL pública a variables de entorno —así la contraseña no queda en
la línea de órdenes ni en el historial— y psql se llama sin argumentos de
conexión:

```powershell
Set-Location "C:\Users\User\Documents\Ventanas"
$kv  = railway variables --service Postgres --kv
$u   = ($kv | Where-Object { $_ -like 'DATABASE_PUBLIC_URL=*' } | Select-Object -First 1).Substring(20)
$uri = [uri]$u
$env:PGHOST     = $uri.Host
$env:PGPORT     = $uri.Port
$env:PGDATABASE = $uri.AbsolutePath.TrimStart('/')
$env:PGUSER     = [uri]::UnescapeDataString($uri.UserInfo.Split(':')[0])
$env:PGPASSWORD = [uri]::UnescapeDataString($uri.UserInfo.Split(':')[1])
$env:PGCLIENTENCODING = 'UTF8'

psql -f "db\correcciones\2026-11-07_lafise_legacy.sql"
```

Lo que se lee al final es lo que importa: el `NOTICE` con el resultado de la
verificación, y `ROLLBACK` o `COMMIT` según cómo termine el archivo.

> Los `NOTICE` salen por stderr y PowerShell los pinta en rojo con un
> `NativeCommandError` alrededor. No es un error: es el aviso del script.

## Historial

| Archivo | Qué arregla |
|---|---|
| `2026-11-07_lafise_legacy.sql` | Saca las 178 filas del ETL viejo (`import_batch = 'excel-legacy'`) de la cuenta **Ventanas LAFISE (operativa)**, que quedaron duplicadas al subir el estado de cuenta completo. Deja la cadena de saldos en 48,209.76, igual al saldo que reporta el banco. |
