import { loadLocalEnv, readAppDatabaseUrl, readDatabaseUrl, redactDatabaseUrl } from "./config.js";
import { createLogger } from "./logging.js";
import { startTelemetry } from "./telemetry.js";

loadLocalEnv();
const telemetry = startTelemetry();
const logger = createLogger("worker");

const { startQueue } = await import("./queue.js");
const { createDb, createPool } = await import("./db/client.js");
const { registerImageryIngestWorker } = await import("./imagery/queue.js");

let stopping = false;

async function shutdown(boss: Awaited<ReturnType<typeof startQueue>>): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  logger.info("worker stopping");
  await boss.stop({ graceful: true, close: true, timeout: 10_000 });
  await telemetry.shutdown();
}

try {
  const databaseUrl = readDatabaseUrl();
  const appPool = createPool(readAppDatabaseUrl());
  const boss = await startQueue(databaseUrl, (error) => {
    logger.error({ err: error }, "pg-boss error");
  });
  await registerImageryIngestWorker(boss, createDb(appPool));
  logger.info({ database: redactDatabaseUrl(databaseUrl) }, "worker ready");
  const stop = async (): Promise<void> => {
    await shutdown(boss);
    await appPool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void stop();
  });
  process.on("SIGTERM", () => {
    void stop();
  });
} catch (error) {
  logger.error({ err: error }, "worker failed to start");
  await telemetry.shutdown();
  process.exit(1);
}
