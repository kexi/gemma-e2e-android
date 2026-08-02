import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 5174, so the fixture app and the dashboard (5173) can both be up while a web
// scenario runs -- which is the normal case, since the dashboard is what runs
// it.
const PORT = 5174;

export default defineConfig({
  plugins: [react()],
  server: { port: PORT, strictPort: true },
  preview: { port: PORT, strictPort: true },
});
