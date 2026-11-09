import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Los dos colores de estado de glif.app (owner, 2026-11-09). Entran
        // SOLO donde algo avisa. Los teal/navy/ambar de la marca no se tocan:
        // son los que imprime el Excel y la paridad pantalla-libro vale mas
        // que la moda.
        alerta: "#ff7b2f",
        peligro: "#c52a38",
        // Azul de marca. El 700 es el #151916 que ya usaban la cabecera, los
        // encabezados de tabla y el export a Excel: acá deja de ser un hex suelto
        // repetido en 13 archivos y pasa a ser un token.
        // La rampa de marca, anclada en glif.app (owner, 2026-11-09).
        // Publicados por glif: 100 (surface-highlight), 500 (ring) y
        // 700 (success). Los otros ocho pasos estan interpolados entre esos
        // tres -- no son de glif, son derivados.
        brand: {
          50: "#eef7f2",
          100: "#d8f4e6", // glif surface-highlight
          200: "#b8e8d2",
          300: "#8ed7b5",
          400: "#4fb88c",
          500: "#2f956e", // glif ring
          600: "#157a57",
          700: "#005c40", // glif success — marca
          800: "#004a34",
          900: "#0b3c2a",
          950: "#06241a",
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
        // Escala corta para tablas densas. Reemplaza a los text-xs…text-[12px]
        // sueltos (172 usos), que no tenían interlineado y apretaban las filas.
        // ⚠️ Era 10px y se escapo del piso de 12px porque no es un literal
        // `text-[10px]` sino un nombre del tema. Ahora 12px, igual que text-xs.
        micro: ["0.75rem", { lineHeight: "1rem" }], // 12px — etiquetas, sufijos
        // Era 11px y tambien se escapo del piso: es un nombre del tema, no
        // un literal. Queda igual que `micro` y que `text-xs` -- tres nombres
        // para el mismo 12px, que es lo que hay que tener en una tabla densa.
        mini: ["0.75rem", { lineHeight: "1rem" }], // 12px — celdas densas
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
