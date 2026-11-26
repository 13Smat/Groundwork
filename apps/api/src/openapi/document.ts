import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildApp } from "../app.js";
import { readAppDatabaseUrl, readAuthDatabaseUrl } from "../config.js";
import { createPool } from "../db/client.js";
import { blockingBreaks, diffOpenApi, type BreakingChange } from "./diff.js";

export function openApiPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../openapi.json");
}

export function canonicalize(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeys(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortKeys(item)]),
    );
  }
  return value;
}

export async function generateOpenApi(): Promise<unknown> {
  const database = {
    app: createPool(readAppDatabaseUrl()),
    auth: createPool(readAuthDatabaseUrl()),
  };
  const app = await buildApp({ logger: false, database });
  try {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    if (response.statusCode !== 200) {
      throw new Error(`/openapi.json returned ${response.statusCode}.`);
    }
    const document: unknown = response.json();
    const self = diffOpenApi(document, document);
    if (self.length > 0) {
      throw new Error(`The generated document differs from itself: ${formatBreaks(self)}`);
    }
    return document;
  } finally {
    await app.close();
    await database.app.end();
    await database.auth.end();
  }
}

export type OpenApiDocument = {
  openapi?: string;
  info?: { version?: string; title?: string };
  paths?: Record<
    string,
    Record<
      string,
      | {
          tags?: string[];
          parameters?: { name: string; in: string }[];
          requestBody?: unknown;
        }
      | undefined
    >
  >;
};

export function readOpenApi(file = openApiPath()): OpenApiDocument {
  return JSON.parse(readFileSync(file, "utf8")) as OpenApiDocument;
}

export function writeOpenApi(document: unknown, file = openApiPath()): void {
  writeFileSync(file, canonicalize(document));
}

export function formatBreaks(changes: BreakingChange[]): string {
  return changes.map((change) => `${change.rule} ${change.location}: ${change.detail}`).join("\n");
}

export function breaksAgainst(base: unknown, head: unknown): BreakingChange[] {
  return blockingBreaks(base, head);
}
