/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        border: "var(--border)",
        surface: "var(--surface)",
      },
    },
  },
  plugins: [],
};
