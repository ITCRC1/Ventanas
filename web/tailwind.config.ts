import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Paleta tomada de los estados del Job Cost Report (task_state.color_hex)
        estado: {
          not_started: "#CCCCCC",
          in_process: "#FFFF00",
          approved: "#1155CC",
          attention: "#B85B22",
          completed: "#38761D",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
