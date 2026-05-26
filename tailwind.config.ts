import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Inter",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        ink: {
          50: "#f7f7f8",
          100: "#ececef",
          200: "#d4d4da",
          300: "#a8a8b3",
          400: "#76767f",
          500: "#52525a",
          600: "#3f3f46",
          700: "#2a2a30",
          800: "#1c1c20",
          900: "#0f0f12",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,15,18,0.04), 0 1px 3px rgba(15,15,18,0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
