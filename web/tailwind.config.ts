import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Azul de marca. El 700 es el #2d3a5c que ya usaban la cabecera, los
        // encabezados de tabla y el export a Excel: acá deja de ser un hex suelto
        // repetido en 13 archivos y pasa a ser un token.
        brand: {
          50: "#f4f6fa",
          100: "#e7ecf5",
          200: "#cbd6e8",
          300: "#a3b5d3",
          400: "#748cb6",
          500: "#526b9b",
          600: "#3c527d",
          700: "#2d3a5c", // marca
          800: "#242e49",
          900: "#1a2235",
          950: "#111726",
        },
        // Estados del Job Cost Report (task_state.color_hex). No se tocan: son
        // dato de la base y tienen que coincidir con el Excel.
        estado: {
          not_started: "#CCCCCC",
          in_process: "#FFFF00",
          approved: "#1155CC",
          attention: "#B85B22",
          completed: "#38761D",
        },
      },
      fontSize: {
        // Escala corta para tablas densas. Reemplaza a los text-[9px]…text-[12px]
        // sueltos (172 usos), que no tenían interlineado y apretaban las filas.
        micro: ["0.625rem", { lineHeight: "0.875rem" }], // 10px — etiquetas, sufijos
        mini: ["0.6875rem", { lineHeight: "1rem" }], // 11px — celdas densas
        compact: ["0.75rem", { lineHeight: "1.125rem" }], // 12px — tablas normales
      },
      boxShadow: {
        // Sombras planas: en pantallas con mucha tabla, el relieve ensucia.
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)",
        pop: "0 4px 6px -1px rgb(15 23 42 / 0.08), 0 10px 20px -5px rgb(15 23 42 / 0.12)",
      },
    },
  },
  plugins: [],
} satisfies Config;
