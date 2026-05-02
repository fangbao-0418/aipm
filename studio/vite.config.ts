import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4310",
      "/health": "http://127.0.0.1:4310"
    }
  },
  build: {
    outDir: resolve(__dirname, "..", "dist", "studio-client"),
    emptyOutDir: true
  }
});
