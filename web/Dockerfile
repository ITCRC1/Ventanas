# Front — DASHBOARD VENTANAS (Next.js 15, salida standalone).
# Contexto de build: la carpeta web/ (en Railway, Root Directory = web).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# A dónde reenvía /api/*. TIENE que estar en tiempo de BUILD: Next resuelve los
# rewrites hacia .next/routes-manifest.json, no en tiempo de ejecución. Cambiar
# la variable en Railway sin volver a construir no surte efecto.
# El default asume que el servicio de la API se llama "api" y escucha en 8080.
ARG API_PROXY_TARGET=http://api.railway.internal:8080
ENV API_PROXY_TARGET=$API_PROXY_TARGET
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=::

RUN addgroup -g 10001 nodejs && adduser -u 10001 -G nodejs -S nextjs

# La salida standalone ya trae su propio node_modules recortado.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 8080

# HOSTNAME=:: para que el proxy de Railway (IPv6) llegue al contenedor.
CMD ["node", "server.js"]
