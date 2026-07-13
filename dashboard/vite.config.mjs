import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const dashboardDir = fileURLToPath(new URL(".", import.meta.url));
const sourceDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  root: dashboardDir,
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      "@": sourceDir,
      "@layout": fileURLToPath(new URL("./src/layout", import.meta.url)),
      "@components": fileURLToPath(new URL("./src/components", import.meta.url)),
      "@hooks": fileURLToPath(new URL("./src/hooks", import.meta.url)),
      "@lib": fileURLToPath(new URL("./src/lib", import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
  },
});
