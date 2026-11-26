import type { Writable } from "node:stream";
import pino, { type Logger, type LoggerOptions, stdSerializers } from "pino";

function redactUrl(url: string | undefined): string | undefined {
  if (!url) {
    return url;
  }
  return url.replace(/\/public\/proposals\/[^/?]+/g, "/public/proposals/[redacted]");
}

const REDACTED = "[redacted]";

export function createLoggerOptions(): LoggerOptions {
  const level = process.env.LOG_LEVEL?.trim() || "info";
  return {
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["x-esign-signature"]',
        "req.params.token",
        "password",
        "secretAccessKey",
        "*.password",
        "*.secretAccessKey",
        "*.authorization",
      ],
      censor: REDACTED,
    },
    serializers: {
      req(req) {
        const base = stdSerializers.req(req);
        const url = redactUrl(base.url);
        const headers = { ...base.headers };
        delete headers["x-esign-signature"];
        const params =
          base.params && typeof base.params === "object"
            ? { ...(base.params as Record<string, unknown>) }
            : undefined;
        if (params && url?.includes("/public/proposals/")) {
          params.token = "[redacted]";
        }
        return { ...base, url, headers, ...(params ? { params } : {}) };
      },
    },
  };
}

export function createLogger(name: string, destination?: Writable): Logger {
  const options = { ...createLoggerOptions(), name };
  return destination ? pino(options, destination) : pino(options);
}

export { REDACTED };
