import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

/** Manrope, la misma de glif.app (owner, 2026-11-09).
 *
 *  Va por `next/font/google`, no por un <link>: Next la descarga EN EL BUILD y
 *  la sirve desde el propio dominio. Asi no hay una peticion a Google en cada
 *  carga —ni la pantalla en blanco si ese dominio no responde— y el dueño no
 *  depende de una red ajena para leer sus numeros.
 *
 *  Variable 200..800: un solo archivo cubre los pesos 500/600/700 que usa el
 *  sistema, sin bajar cuatro ficheros. */
const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--fuente-manrope",
});

export const metadata: Metadata = {
  title: "Dashboard Ventanas",
  description: "Control financiero del proyecto Ventanas",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={manrope.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
