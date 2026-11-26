import {
  loadLocalEnv,
  readAppDatabaseUrl,
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
const { checkTitiler } = await import("./imagery/proxy.js");
const { checkObjectStorage } = await import("./storage/s3.js");

const databaseUrl = readAppDatabaseUrl();
const pool = createPool(databaseUrl);

async function assertTenantRole(): Promise<void> {
  const result = await pool.query<{
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
  if (!row || row.rolsuper || row.rolbypassrls) {
    throw new Error(
      `The API is connected as ${row?.current_user ?? "unknown"}, which bypasses row security. Use APP_DATABASE_URL for the groundwork_app role.`,
    );
  }
  logger.info({ postgis: row.postgis_version, role: row.current_user }, "postgres ready");
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
  await pool.end();
  await telemetry.shutdown();
  process.exit(1);
}

const app = await buildApp({ logger, imagery: { db: createDb(pool) } });
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
