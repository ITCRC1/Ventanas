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

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=::

# A dónde reenvía /api/*. Se lee EN CADA PEDIDO (app/api/[...path]/route.ts), así
# que cambiarla en Railway sólo necesita un reinicio, no reconstruir la app.
# El default asume que el servicio de la API se llama "api" y escucha en 8080.
ENV API_PROXY_TARGET=http://api.railway.internal:8080

RUN addgroup -g 10001 nodejs && adduser -u 10001 -G nodejs -S nextjs

# La salida standalone ya trae su propio node_modules recortado.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 8080

# HOSTNAME=:: para que el proxy de Railway (IPv6) llegue al contenedor.
CMD ["node", "server.js"]
