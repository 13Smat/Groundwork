import type { Writable } from "node:stream";
import pino, { type Logger, type LoggerOptions } from "pino";

const REDACTED = "[redacted]";

export function createLoggerOptions(): LoggerOptions {
  const level = process.env.LOG_LEVEL?.trim() || "info";
  return {
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "password",
        "secretAccessKey",
        "*.password",
        "*.secretAccessKey",
        "*.authorization",
      ],
      censor: REDACTED,
    },
  };
}

export function createLogger(name: string, destination?: Writable): Logger {
  const options = { ...createLoggerOptions(), name };
  return destination ? pino(options, destination) : pino(options);
}

export { REDACTED };
