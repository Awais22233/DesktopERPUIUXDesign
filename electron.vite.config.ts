import { resolve } from "node:path"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { "@shared": resolve("src/shared"), "@core": resolve("src/core") } },
    build: { outDir: "out/main", rollupOptions: { input: { index: resolve("src/main/index.ts") } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: { input: { index: resolve("src/preload/index.ts") }, output: { format: "cjs", entryFileNames: "[name].cjs" } },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@shared": resolve("src/shared") } },
    build: { outDir: resolve("out/renderer"), rollupOptions: { input: resolve("src/renderer/index.html") } },
  },
})
