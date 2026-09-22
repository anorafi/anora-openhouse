import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 8000,
    allowedHosts: [".trycloudflare.com"],
  },
  test: {
    environment: "node",
  },
});
