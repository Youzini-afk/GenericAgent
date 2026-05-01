/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Segoe UI Variable Text",
          "Segoe UI",
          "Microsoft YaHei UI",
          "Microsoft YaHei",
          "PingFang SC",
          "Noto Sans CJK SC",
          "sans-serif"
        ],
        mono: ["Cascadia Mono", "Cascadia Code", "Consolas", "monospace"]
      }
    }
  },
  plugins: []
};
