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
      // The office app owns GET /invites/:token. Only the accept POST is the API.
      "/invites": {
        ...proxy,
        bypass(req: { method?: string }) {
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
      "/clients": proxy,
      "/contacts": proxy,
      "/locations": proxy,
      "/jobs": proxy,
      "/estimates": proxy,
      "/proposals": proxy,
      "/proposal-templates": proxy,
      "/line-items": proxy,
      "/takeoffs": proxy,
      "/measurements": proxy,
      "/detections": proxy,
      "/search": proxy,
      "/pipeline": proxy,
      "/imagery": proxy,
      "/admin": proxy,
      "/openapi.json": proxy,
      "/healthz": proxy,
    },
  },
});
