// Proxy de /api/* hacia el backend FastAPI.
//
// Reemplaza al rewrite de next.config.mjs por un motivo concreto: Next resuelve
// los rewrites AL CONSTRUIR (quedan en routes-manifest.json), así que cambiar el
// destino obligaba a reconstruir toda la app. Acá se lee al atender cada pedido:
// se cambia la variable, se reinicia, listo.
//
// El front y la API comparten origen, así que la cookie de sesión viaja sin CORS.

import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function destino(): string {
  return (process.env.API_PROXY_TARGET ?? "http://localhost:8000").replace(/\/+$/, "");
}

// No se reenvían: las recalcula fetch o pertenecen al salto anterior.
const OMITIR = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
]);

async function proxy(req: NextRequest): Promise<Response> {
  const url = destino() + req.nextUrl.pathname + req.nextUrl.search;

  const headers = new Headers();
  req.headers.forEach((valor, clave) => {
    if (!OMITIR.has(clave.toLowerCase())) headers.set(clave, valor);
  });

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    // manual: el 302 del callback de OIDC tiene que llegarle al navegador.
    redirect: "manual",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = req.body;
    init.duplex = "half";
  }

  let arriba: Response;
  try {
    arriba = await fetch(url, init);
  } catch (e) {
    // El código de causa es el diagnóstico: ENOTFOUND = el nombre del servicio no
    // existe; ECONNREFUSED = resuelve pero nadie escucha en ese puerto.
    const err = e as { message?: string; cause?: { code?: string; message?: string } };
    const causa = err.cause?.code ?? err.cause?.message ?? err.message ?? "desconocida";
    return new Response(
      JSON.stringify({
        type: "about:blank",
        title: "El front no pudo hablar con la API",
        status: 502,
        detail: `${causa} — destino: ${url}`,
      }),
      { status: 502, headers: { "content-type": "application/problem+json" } },
    );
  }

  const salida = new Headers();
  arriba.headers.forEach((valor, clave) => {
    const k = clave.toLowerCase();
    // fetch ya descomprimió el cuerpo: reenviar content-encoding rompe al navegador.
    // set-cookie se copia aparte porque puede venir repetida.
    if (k === "content-encoding" || k === "content-length") return;
    if (k === "transfer-encoding" || k === "connection" || k === "set-cookie") return;
    salida.set(clave, valor);
  });
  for (const cookie of arriba.headers.getSetCookie()) {
    salida.append("set-cookie", cookie);
  }

  // El cuerpo se reenvía como stream: los PDF y los Excel pueden pesar.
  return new Response(arriba.body, {
    status: arriba.status,
    statusText: arriba.statusText,
    headers: salida,
  });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as HEAD,
  proxy as OPTIONS,
};
