/** @type {import('next').NextConfig} */
const API = process.env.API_PROXY_TARGET ?? "http://localhost:8000";

const nextConfig = {
  reactStrictMode: true,
  // Salida autocontenida para el contenedor: .next/standalone trae server.js y
  // sólo los node_modules que hacen falta.
  output: "standalone",
  // El front y el backend comparten origen: /api/* del front se reenvía al
  // FastAPI. Así la cookie de sesión viaja sin CORS ni dominio cruzado, en
  // local y en Railway por igual.
  //
  // OJO: los rewrites se resuelven al CONSTRUIR (quedan en routes-manifest.json).
  // API_PROXY_TARGET tiene que estar presente en el build, no sólo al arrancar.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};

export default nextConfig;
