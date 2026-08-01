import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_TARGET = process.env["API_URL"] ?? "http://localhost:5175";

export default defineConfig({
  plugins: [react()],
  server: {
    // The SPA and the Hono server are separate processes in development, so
    // /api and /screenshots are proxied instead of served: that keeps the
    // browser on one origin and makes SSE work without any CORS handling.
    proxy: {
      // ws:true is required for the Device page's frame stream; without it the
      // upgrade request is proxied as plain HTTP and the socket never opens.
      "/api": { target: API_TARGET, changeOrigin: true, ws: true },
      "/screenshots": { target: API_TARGET, changeOrigin: true },
      "/videos": { target: API_TARGET, changeOrigin: true },
    },
  },
});
