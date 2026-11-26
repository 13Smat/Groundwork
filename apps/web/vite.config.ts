import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.VITE_API_PROXY ?? "http://127.0.0.1:3001";

// Document loads for /jobs/:id share a path with the API. A reload must stay
// in the office app. Fetches do not send text/html.
const proxy = {
  target: api,
  changeOrigin: false,
  bypass(req: { headers: { accept?: string | string[] } }) {
    const accept = req.headers.accept;
    const header = Array.isArray(accept) ? accept.join(",") : (accept ?? "");
    if (header.includes("text/html")) {
      return "/index.html";
    }
  },
};

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
      "/clients": proxy,
      "/contacts": proxy,
      "/locations": proxy,
      "/jobs": proxy,
      "/search": proxy,
      "/pipeline": proxy,
      "/imagery": proxy,
      "/admin": proxy,
      "/openapi.json": proxy,
      "/healthz": proxy,
    },
  },
});
