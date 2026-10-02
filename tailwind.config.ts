import type { Config } from "tailwindcss";

// Tailwind CSS 3.4.x (CSS v4 deliberately not used: project requirement).
// Colours mirror src/game/engine/palette.ts.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#03130a",
        deep: "#062a14",
        forest: "#005d1f",
        heading: "#13670b",
        leaf: "#277816",
        bright: "#12a415",
        star: { DEFAULT: "#e1251b", dark: "#8f1009" },
        silver: "#c9cfcb",
        cream: "#f3f6f1",
        gold: "#ffc94a",
        heat: "#ff7a1a",
        ice: "#9fe3ff",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
      },
      keyframes: {
        "beam-sway": { "0%,100%": { transform: "rotate(-6deg)" }, "50%": { transform: "rotate(6deg)" } },
        "star-spin": { "0%": { transform: "rotateY(0deg)" }, "100%": { transform: "rotateY(360deg)" } },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-24px)" } },
        "pulse-soft": { "0%,100%": { opacity: "1", transform: "scale(1)" }, "50%": { opacity: "0.55", transform: "scale(0.97)" } },
        "rise-in": { "0%": { opacity: "0", transform: "translateY(60px) scale(0.96)" }, "100%": { opacity: "1", transform: "none" } },
        "pop-in": { "0%": { opacity: "0", transform: "scale(0.4)" }, "60%": { opacity: "1", transform: "scale(1.08)" }, "100%": { transform: "scale(1)" } },
        count: { "0%": { opacity: "0", transform: "scale(2.2)" }, "25%": { opacity: "1", transform: "scale(1)" }, "80%": { opacity: "1" }, "100%": { opacity: "0", transform: "scale(0.7)" } },
        drift: { "0%": { transform: "translateY(0) rotate(0deg)" }, "100%": { transform: "translateY(2200px) rotate(360deg)" } },
        shine: { "0%": { transform: "translateX(-120%) skewX(-20deg)" }, "100%": { transform: "translateX(220%) skewX(-20deg)" } },
      },
      animation: {
        "beam-sway": "beam-sway 9s ease-in-out infinite",
        "star-spin": "star-spin 8s linear infinite",
        float: "float 5s ease-in-out infinite",
        "pulse-soft": "pulse-soft 1.8s ease-in-out infinite",
        "rise-in": "rise-in 0.55s cubic-bezier(0.16,1,0.3,1) both",
        "pop-in": "pop-in 0.6s cubic-bezier(0.16,1,0.3,1) both",
        count: "count 0.8s cubic-bezier(0.16,1,0.3,1) both",
        drift: "drift linear infinite",
        shine: "shine 2.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
