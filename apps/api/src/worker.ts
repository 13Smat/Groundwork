import { loadLocalEnv, readDatabaseUrl, redactDatabaseUrl } from "./config.js";
import { createLogger } from "./logging.js";
import { startTelemetry } from "./telemetry.js";

loadLocalEnv();
const telemetry = startTelemetry();
const logger = createLogger("worker");

const { startQueue } = await import("./queue.js");

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
  const boss = await startQueue(databaseUrl, (error) => {
    logger.error({ err: error }, "pg-boss error");
  });
  logger.info({ database: redactDatabaseUrl(databaseUrl) }, "worker ready");
  process.on("SIGINT", () => {
    void shutdown(boss).then(() => process.exit(0));
  });
  process.on("SIGTERM", () => {
    void shutdown(boss).then(() => process.exit(0));
  });
} catch (error) {
  logger.error({ err: error }, "worker failed to start");
  await telemetry.shutdown();
  process.exit(1);
}
