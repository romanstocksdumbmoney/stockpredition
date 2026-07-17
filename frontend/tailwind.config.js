/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter"', "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"]
      },
      colors: {
        page: "#0B0F17",
        surface: "#0E141F",
        inset: "#121826",
        hairline: "#1E2633",
        bull: "#2DD4A8",
        bullTint: "#0E1B26",
        bear: "#E25D4B",
        bearTint: "#1A0F0E",
        bearText: "#DCC8C4",
        warn: "#E8A33D",
        textPrimary: "#F2F5F9",
        textSecondary: "#C8D2DC",
        textMuted: "#7B8794"
      }
    }
  },
  plugins: []
};
