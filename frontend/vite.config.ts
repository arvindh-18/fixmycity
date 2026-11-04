import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const API = process.env.VITE_API_PROXY ?? "http://localhost:8000";

// In development the Vite server proxies API, media and WebSocket traffic to FastAPI,
// so the browser only ever talks to one origin (no CORS surprises).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": "/src" } },
  server: {
    port: 5173,
    proxy: {
      "/api": API,
      "/media": API,
      "/ws": { target: API.replace("http", "ws"), ws: true },
    },
  },
  // MapLibre loads its web worker relative to its own module; pre-bundling breaks that path in dev.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  build: { chunkSizeWarningLimit: 1600 },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
