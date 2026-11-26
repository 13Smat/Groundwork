import { afterEach, describe, expect, it } from "vitest";

import {
  LOCAL_DATABASE_URL,
  LOCAL_TILE_SIGNING_SECRET,
  readAppDatabaseUrl,
  readDatabaseUrl,
  readObjectStorageConfig,
  readPort,
  readTileSigningSecret,
  readTitilerUrl,
  redactDatabaseUrl,
} from "../src/config.js";

const touched = [
  "NODE_ENV",
  "DATABASE_URL",
  "APP_DATABASE_URL",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "TITILER_URL",
  "TILE_SIGNING_SECRET",
] as const;
const previous = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of touched) {
    const value = previous.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  previous.clear();
});

function setEnv(values: Partial<Record<(typeof touched)[number], string | undefined>>): void {
  for (const key of touched) {
    if (!previous.has(key)) {
      previous.set(key, process.env[key]);
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("config", () => {
  it("uses the local database default outside production", () => {
    setEnv({ NODE_ENV: "development", DATABASE_URL: undefined, APP_DATABASE_URL: undefined });
    expect(readDatabaseUrl()).toBe(LOCAL_DATABASE_URL);
    expect(readAppDatabaseUrl()).toContain("groundwork_app");
  });

  it("refuses a missing database url in production", () => {
    setEnv({ NODE_ENV: "production", DATABASE_URL: undefined });
    expect(() => readDatabaseUrl()).toThrow(/DATABASE_URL is required/);
  });

  it("prefers an explicit database url", () => {
    setEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://owner:secret@db.example:5432/groundwork",
    });
    expect(readDatabaseUrl()).toBe("postgres://owner:secret@db.example:5432/groundwork");
  });

  it("redacts the password in a database url", () => {
    const redacted = redactDatabaseUrl("postgres://owner:secret@127.0.0.1:5432/groundwork");
    expect(redacted).not.toContain("secret");
    expect(redacted).toContain("127.0.0.1");
  });

  it("reads an empty port as 3001 and rejects a bad port", () => {
    expect(readPort(undefined)).toBe(3001);
    expect(readPort("")).toBe(3001);
    expect(() => readPort("0")).toThrow(/PORT/);
  });

  it("requires object storage settings in production", () => {
    setEnv({ NODE_ENV: "production", S3_ENDPOINT: undefined, S3_BUCKET: undefined });
    expect(() => readObjectStorageConfig()).toThrow(/S3_ENDPOINT is required/);
  });

  it("uses the local tile service outside production and refuses it in production", () => {
    setEnv({ NODE_ENV: "development", TITILER_URL: undefined, TILE_SIGNING_SECRET: undefined });
    expect(readTitilerUrl().origin).toBe("http://127.0.0.1:8080");
    expect(readTileSigningSecret()).toBe(LOCAL_TILE_SIGNING_SECRET);

    setEnv({ NODE_ENV: "production", TILE_SIGNING_SECRET: undefined });
    expect(() => readTileSigningSecret()).toThrow(/TILE_SIGNING_SECRET/);

    setEnv({ NODE_ENV: "production", TILE_SIGNING_SECRET: LOCAL_TILE_SIGNING_SECRET });
    expect(() => readTileSigningSecret()).toThrow(/non-default/);

    setEnv({
      NODE_ENV: "production",
      TITILER_URL: "https://services.nconemap.gov/tiles",
      TILE_SIGNING_SECRET: "a-real-signing-secret",
    });
    expect(() => readTitilerUrl()).toThrow(/not allowed/);
  });
});
