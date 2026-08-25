/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Manrope"', "ui-sans-serif", "system-ui", "sans-serif"],
        display: ['"Newsreader"', "Georgia", "serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        ink: {
          DEFAULT: "#12141A",
          soft: "#3A3F4B",
          mute: "#6B7280",
          faint: "#9AA1AE",
        },
        mist: {
          DEFAULT: "#EEF1F4",
          soft: "#F6F7F9",
          deep: "#E2E6EC",
        },
        pine: {
          DEFAULT: "#0E6B5C",
          soft: "#E6F4F1",
          mid: "#148574",
        },
        clay: {
          DEFAULT: "#C45C4A",
          soft: "#F8EBE8",
        },
        sand: {
          DEFAULT: "#B8860B",
          soft: "#F8F1DE",
        },
        skyline: {
          DEFAULT: "#3D6B8C",
          soft: "#E8F0F5",
        },
      },
      boxShadow: {
        panel: "0 1px 0 rgba(18, 20, 26, 0.04), 0 8px 24px rgba(18, 20, 26, 0.04)",
        lift: "0 12px 40px rgba(18, 20, 26, 0.08)",
      },
      borderRadius: {
        panel: "14px",
      },
      keyframes: {
        rise: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        rise: "rise 0.45s ease-out both",
        shimmer: "shimmer 1.4s linear infinite",
      },
    },
  },
  plugins: [],
};
