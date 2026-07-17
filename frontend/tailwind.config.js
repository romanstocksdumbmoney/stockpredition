/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bull: "#22c55e",
        bear: "#ef4444",
        accent: "#38bdf8"
      }
    }
  },
  plugins: []
};
