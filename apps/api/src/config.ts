import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Laptop defaults. They match docker-compose.yml and are not hosted credentials.
 * NODE_ENV=production refuses them. ADR 0005.
 */
export const LOCAL_DATABASE_URL = "postgres://groundwork:groundwork@127.0.0.1:5432/groundwork";
export const LOCAL_APP_DATABASE_URL =
  "postgres://groundwork_app:groundwork@127.0.0.1:5432/groundwork";
export const LOCAL_APP_DB_PASSWORD = "groundwork";
export const LOCAL_S3_ENDPOINT = "http://127.0.0.1:9000";
export const LOCAL_S3_REGION = "us-east-1";
export const LOCAL_S3_BUCKET = "groundwork";
export const LOCAL_S3_ACCESS_KEY_ID = "minioadmin";
export const LOCAL_S3_SECRET_ACCESS_KEY = "minioadmin";

export const APP_ROLE = "groundwork_app";

export function loadLocalEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(process.cwd(), ".env"), path.resolve(here, "../../../.env")];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate) || !existsSync(candidate)) {
      continue;
    }
    seen.add(candidate);
    process.loadEnvFile(candidate);
    return;
  }
}

function readOptional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readOrLocal(name: string, local: string): string {
  const value = readOptional(name);
  if (value) {
    return value;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} is required when NODE_ENV is production.`);
  }
  return local;
}

export function readDatabaseUrl(): string {
  return readOrLocal("DATABASE_URL", LOCAL_DATABASE_URL);
}

export function readAppDatabaseUrl(): string {
  return readOrLocal("APP_DATABASE_URL", LOCAL_APP_DATABASE_URL);
}

export function readAppDbPassword(): string {
  return readOrLocal("APP_DB_PASSWORD", LOCAL_APP_DB_PASSWORD);
}

export function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return 3001;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535. Received ${raw}.`);
  }
  return port;
}

export function readHost(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    return "0.0.0.0";
  }
  return raw.trim();
}

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function readObjectStorageConfig(): ObjectStorageConfig {
  return {
    endpoint: readOrLocal("S3_ENDPOINT", LOCAL_S3_ENDPOINT),
    region: readOrLocal("S3_REGION", LOCAL_S3_REGION),
    bucket: readOrLocal("S3_BUCKET", LOCAL_S3_BUCKET),
    accessKeyId: readOrLocal("S3_ACCESS_KEY_ID", LOCAL_S3_ACCESS_KEY_ID),
    secretAccessKey: readOrLocal("S3_SECRET_ACCESS_KEY", LOCAL_S3_SECRET_ACCESS_KEY),
  };
}

/** Hide a database password before it reaches a log line. */
export function redactDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = "***";
    }
    return url.toString();
  } catch {
    return "unparsed database url";
  }
}
