import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type pg from "pg";

import { loadLocalEnv, readAppDbPassword, readDatabaseUrl, redactDatabaseUrl } from "../config.js";
import { createLogger } from "../logging.js";
import { createPool } from "./client.js";
import { ensureAppRole } from "./roles.js";

const LOCK_KEY = 874221;

export type MigrateResult = {
  applied: string[];
  reverted: string[];
};

export function migrationsDirectory(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../../db/migrations");
}

export function listUpMigrations(directory = migrationsDirectory()): string[] {
  return readdirSync(directory)
    .filter((name) => /^\d+_.+\.sql$/.test(name) && !name.endsWith(".down.sql"))
    .sort();
}

function versionOf(filename: string): string {
  return filename.replace(/\.sql$/, "");
}

async function ensureLedger(client: pg.PoolClient): Promise<void> {
  await client.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function appliedVersions(client: pg.PoolClient): Promise<Set<string>> {
  const result = await client.query<{ version: string }>("select version from schema_migrations");
  return new Set(result.rows.map((row) => row.version));
}

export async function migrate(direction: "up" | "down"): Promise<MigrateResult> {
  loadLocalEnv();
  const databaseUrl = readDatabaseUrl();
  const pool = createPool(databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await ensureAppRole(pool, readAppDbPassword());
    await ensureLedger(client);
    if (direction === "up") {
      return { applied: await applyUp(client), reverted: [] };
    }
    return { applied: [], reverted: await applyDown(client) };
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

async function applyUp(client: pg.PoolClient): Promise<string[]> {
  const applied = await appliedVersions(client);
  const directory = migrationsDirectory();
  const pending = listUpMigrations(directory).filter((name) => !applied.has(versionOf(name)));
  const ran: string[] = [];
  for (const filename of pending) {
    const version = versionOf(filename);
    const sql = readFileSync(path.join(directory, filename), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (version) values ($1)", [version]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    ran.push(version);
  }
  return ran;
}

async function applyDown(client: pg.PoolClient): Promise<string[]> {
  const latest = await client.query<{ version: string }>(
    "select version from schema_migrations order by version desc limit 1",
  );
  const version = latest.rows[0]?.version;
  if (!version) {
    throw new Error("No applied migration to revert.");
  }
  const filename = `${version}.down.sql`;
  const sql = readFileSync(path.join(migrationsDirectory(), filename), "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("delete from schema_migrations where version = $1", [version]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
  return [version];
}

async function main(): Promise<void> {
  loadLocalEnv();
  const logger = createLogger("migrate");
  const direction = process.argv.includes("--down") ? "down" : "up";
  let database = "unknown";
  try {
    database = redactDatabaseUrl(readDatabaseUrl());
    const result = await migrate(direction);
    logger.info(
      {
        direction,
        applied: result.applied,
        reverted: result.reverted,
        database,
      },
      result.applied.length === 0 && result.reverted.length === 0
        ? "migrations already applied"
        : "migrations finished",
    );
  } catch (error) {
    logger.error({ err: error, database }, "migration failed");
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
const invokedAsCli =
  process.env.VITEST !== "true" &&
  entry !== undefined &&
  import.meta.url === pathToFileURL(entry).href;

if (invokedAsCli) {
  await main();
}
