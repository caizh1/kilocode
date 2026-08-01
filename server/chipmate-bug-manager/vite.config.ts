import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  root: "web",
  base: "/bugs/",
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/bugs/api": {
        target: "http://127.0.0.1:8321",
        rewrite: (path) => path.replace(/^\/bugs/, ""),
      },
    },
  },
})
