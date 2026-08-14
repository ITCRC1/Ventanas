# API — DASHBOARD VENTANAS
#
# El contexto de build es la RAÍZ del repo, no api/: la migración 0001 lee
# db/schema_v2.sql subiendo tres niveles desde alembic/versions/. Por eso la
# imagen conserva la misma disposición que el repo (/srv/api y /srv/db).

FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Librerías de sistema para WeasyPrint (PDF): Pango/Cairo/GDK-Pixbuf.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 \
    libcairo2 libffi8 shared-mime-info fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# Dependencias primero: cambiar código no invalida esta capa.
COPY api/requirements.txt api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt

# db/ antes que api/: cambia mucho menos seguido.
COPY db/ db/
COPY api/ api/

# Sin root. El uid fijo evita sorpresas si algún día se monta un volumen.
RUN useradd --create-home --uid 10001 ventanas && chown -R ventanas:ventanas /srv
USER ventanas

WORKDIR /srv/api
EXPOSE 8080

# Migraciones y después el servidor. `alembic upgrade head` es idempotente: en un
# reinicio sin migraciones nuevas sólo consulta alembic_version y sigue.
#
# -b [::] y no 0.0.0.0: la red privada de Railway es IPv6, y el front llega por
# ahí (http://api.railway.internal:8080). Con bindv6only=0 —el default de Linux—
# el mismo socket atiende igual el tráfico IPv4 del healthcheck.
#
# --forwarded-allow-ips '*': sin esto uvicorn descarta los X-Forwarded-* del
# proxy de Railway, y el rate limit del login vería una sola IP para todos.
CMD alembic upgrade head && \
    exec gunicorn app.main:app \
      -k uvicorn.workers.UvicornWorker \
      -b "[::]:${PORT:-8080}" \
      --workers "${WEB_CONCURRENCY:-2}" \
      --timeout 120 \
      --graceful-timeout 30 \
      --access-logfile - \
      --forwarded-allow-ips '*'
