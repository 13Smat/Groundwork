import type pg from "pg";

import {
  APP_ROLE,
  AUTH_ROLE,
  loadLocalEnv,
  readAppDatabaseUrl,
  readAuthDatabaseUrl,
  readDatabaseUrl,
  readHost,
  readObjectStorageConfig,
  readPort,
  readTitilerUrl,
  redactDatabaseUrl,
} from "./config.js";
import { createLogger } from "./logging.js";
import { startTelemetry } from "./telemetry.js";

loadLocalEnv();
const telemetry = startTelemetry();
const logger = createLogger("api");

const { buildApp } = await import("./app.js");
const { createDb, createPool } = await import("./db/client.js");
const { ensureImageryIngestQueue, imageryIngestDispatch } = await import("./imagery/queue.js");
const { enqueueProposalRender, registerProposalRenderWorker } =
  await import("./proposals/queue.js");
const { closeProposalBrowser } = await import("./proposals/pdf.js");
const { checkTitiler } = await import("./imagery/proxy.js");
const { startQueue } = await import("./queue.js");
const { checkObjectStorage } = await import("./storage/s3.js");

const databaseUrl = readAppDatabaseUrl();
const authDatabaseUrl = readAuthDatabaseUrl();
const pool = createPool(databaseUrl);
const authPool = createPool(authDatabaseUrl);

async function assertRole(target: pg.Pool, expected: string): Promise<void> {
  const result = await target.query<{
    current_user: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    postgis_version: string;
  }>(`
    select current_user, rolsuper, rolbypassrls, postgis_version() as postgis_version
    from pg_roles
    where rolname = current_user
  `);
  const row = result.rows[0];
  if (!row || row.current_user !== expected || row.rolsuper || row.rolbypassrls) {
    throw new Error(
      `Expected the ${expected} role. Connected as ${row?.current_user ?? "unknown"}, which cannot be used for this pool.`,
    );
  }
}

async function assertTenantRole(): Promise<void> {
  await assertRole(pool, APP_ROLE);
  await assertRole(authPool, AUTH_ROLE);
  const version = await pool.query<{ postgis_version: string }>("select postgis_version()");
  logger.info({ postgis: version.rows[0]?.postgis_version, role: APP_ROLE }, "postgres ready");
}

try {
  await assertTenantRole();
  const storage = readObjectStorageConfig();
  await checkObjectStorage(storage);
  logger.info({ endpoint: storage.endpoint, bucket: storage.bucket }, "object storage ready");
  const titiler = readTitilerUrl();
  await checkTitiler(titiler);
  logger.info({ origin: titiler.origin }, "tile service ready");
} catch (error) {
  logger.error(
    { err: error, database: redactDatabaseUrl(databaseUrl) },
    "startup check failed. Start Postgres, MinIO, and TiTiler with docker compose, then run pnpm db:migrate.",
  );
  await authPool.end();
  await pool.end();
  await telemetry.shutdown();
  process.exit(1);
}

const ownerUrl = readDatabaseUrl();
const boss = await startQueue(ownerUrl, (error) => {
  logger.error({ err: error }, "pg-boss error");
});
await ensureImageryIngestQueue(boss);
const tenantDb = createDb(pool);
await registerProposalRenderWorker(boss, tenantDb);
logger.info({ database: redactDatabaseUrl(ownerUrl) }, "ingest queue ready");

const app = await buildApp({
  logger,
  database: { app: pool, auth: authPool },
  imagery: { db: tenantDb, ingestDispatch: imageryIngestDispatch(boss) },
  proposals: { dispatch: (message) => enqueueProposalRender(boss, message) },
});
const port = readPort(process.env.PORT);
const host = readHost(process.env.HOST);
await app.listen({ port, host });

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  logger.info({ signal }, "shutting down");
  await app.close();
  await closeProposalBrowser();
  await boss.stop({ graceful: true, close: true, timeout: 10_000 });
  await authPool.end();
  await pool.end();
  await telemetry.shutdown();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
