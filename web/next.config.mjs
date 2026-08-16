/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Salida autocontenida para el contenedor: .next/standalone trae server.js y
  // sólo los node_modules que hacen falta.
  output: "standalone",
  // El reenvío de /api/* al backend NO va acá. Los rewrites de Next se resuelven
  // al construir, y eso obligaba a reconstruir la app para cambiar de destino.
  // Vive en app/api/[...path]/route.ts, que lee API_PROXY_TARGET en cada pedido.
};

export default nextConfig;
