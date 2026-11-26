import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.VITE_API_PROXY ?? "http://127.0.0.1:3001";
const proxy = { target: api, changeOrigin: false };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    fs: {
      allow: ["../.."],
    },
    proxy: {
      "/auth": proxy,
      "/me": proxy,
      "/workspaces": proxy,
      "/invites": proxy,
      "/members": proxy,
      "/roles": proxy,
      "/catalog-items": proxy,
      "/openapi.json": proxy,
      "/healthz": proxy,
    },
  },
});
