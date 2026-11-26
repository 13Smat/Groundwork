import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";

import { ProblemError } from "../errors.js";
import type { Auth } from "./auth.js";

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "localhost";
  }
  return value ?? "localhost";
}

/**
 * Mount Better Auth at /auth/*. The response is written raw so Fastify does
 * not JSON-encode the session body a second time.
 */
export function registerAuthHandler(app: FastifyInstance, auth: Auth): void {
  app.route({
    method: ["GET", "POST"],
    url: "/auth/*",
    handler: async (request, reply) => {
      try {
        const url = new URL(request.url, `http://${headerValue(request.headers.host)}`);
        const headers = fromNodeHeaders(request.headers);
        headers.delete("content-length");
        headers.delete("transfer-encoding");
        const req = new Request(url, {
          method: request.method,
          headers,
          ...(request.body !== undefined && request.body !== null
            ? { body: JSON.stringify(request.body) }
            : {}),
        });
        const response = await auth.handler(req);
        reply.hijack();
        reply.raw.statusCode = response.status;
        const cookies = response.headers.getSetCookie();
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() === "set-cookie") {
            return;
          }
          reply.raw.setHeader(key, value);
        });
        if (cookies.length > 0) {
          reply.raw.setHeader("set-cookie", cookies);
        }
        const text = response.body ? await response.text() : "";
        reply.raw.end(text);
      } catch (error) {
        request.log.error(error);
        if (!reply.sent) {
          throw new ProblemError({
            status: 500,
            title: "Internal Server Error",
            detail: "The auth request failed.",
          });
        }
      }
    },
  });
}
