/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          light: "#F7F7FA",
          dark: "#171525",
        },
        surface: {
          light: "#FFFFFF",
          dark: "#211E35",
          darkHover: "#27233D",
        },
        brand: {
          pink: "#D946A8",
          purple: "#7C5CFC",
          pinkSoft: "#FCE7F3",
          purpleSoft: "#EDE9FE",
        },
        darkBorder: "#2E2A4A",
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 4px 20px -2px rgba(0, 0, 0, 0.05)",
        card: "0 2px 12px -2px rgba(0, 0, 0, 0.04)",
        glow: "0 0 20px -5px rgba(217, 70, 168, 0.3)",
      },
      borderRadius: {
        '2xl': '18px',
        '3xl': '24px',
      }
    },
  },
  plugins: [],
};