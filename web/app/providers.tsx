"use client";

import { ApiError } from "@/lib/api";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            // ⚠️ Un 403 no se reintenta: desde que la API cierra pantallas por
            // perfil (2026-11-10), «no tenés permiso» es una respuesta FIRME.
            // Reintentarla duplica cada pedido de cada pantalla que el perfil
            // no puede ver, y la segunda respuesta es idéntica a la primera.
            retry: (intentos, error) =>
              error instanceof ApiError && error.problem.status === 403 ? false : intentos < 1,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
