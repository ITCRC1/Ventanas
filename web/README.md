# Frontend — DASHBOARD VENTANAS (Fase 4)

Next.js 15 (App Router) · TypeScript strict · TanStack Query v5 · Tailwind · biome.
La UI está en español; los totales vienen de la API (cero recálculo en el front).

## Puesta en marcha

```bash
cd web
npm install
copy .env.local.example .env.local   # API_PROXY_TARGET -> backend FastAPI

npm run dev    # http://localhost:3000
```

El backend debe estar corriendo en `http://localhost:8000` (o ajustá
`API_PROXY_TARGET`). Next reenvía `/api/*` al backend para compartir la cookie de
sesión sin CORS.

## Pantallas

| Ruta | Qué es |
|---|---|
| `/login` | Selector de usuario (login de desarrollo). En prod: Microsoft 365. |
| `/job-cost` | **Job Cost Report**: presupuesto vs. gasto por línea, con reasignación de categoría/fase en línea. La base valida que la fase pertenezca a la categoría (si no, la limpia). |

## Estructura

```
web/
├─ app/
│  ├─ layout.tsx · providers.tsx (TanStack Query)
│  ├─ login/page.tsx
│  └─ job-cost/page.tsx
├─ components/  AppShell (nav + guard) · JobCostGrid
└─ lib/         api (fetch + problem+json) · hooks (queries/mutations) · types · format
```

## Calidad

```bash
npx tsc --noEmit
npx biome check .
```

## Pendiente (siguiente)

- Fase 5: cronograma (grilla semanal virtualizada, 52k celdas — TanStack Table + Virtual).
- Permisos por pantalla más finos y manejo de errores con toasts.
