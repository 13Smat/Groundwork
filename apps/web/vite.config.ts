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
      // The office app owns GET /invites/:token. Only the accept POST is the API.
      "/invites": {
        ...proxy,
        bypass(req) {
          if (req.method === "GET") {
            return "/index.html";
          }
        },
      },
      "/members": proxy,
      "/roles": proxy,
      "/catalog-items": proxy,
      "/takeoff-items": proxy,
      "/cost-recipes": proxy,
      "/formula": proxy,
      "/imagery": proxy,
      "/admin": proxy,
      "/openapi.json": proxy,
      "/healthz": proxy,
    },
  },
});
