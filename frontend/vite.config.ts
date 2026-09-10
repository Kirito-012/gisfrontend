import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend dev server on :5173, backend FastAPI on :8000.
// All /api/* calls are proxied so there is no CORS dance in dev.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
