import { pathToFileURL } from "node:url";

import { loadLocalEnv, readAppDatabaseUrl } from "../config.js";
import { createDb, createPool } from "../db/client.js";
import { createLogger } from "../logging.js";
import { seedDemo } from "./demo.js";

async function main(): Promise<void> {
  loadLocalEnv();
  const logger = createLogger("seed");
  const pool = createPool(readAppDatabaseUrl());
  try {
    const result = await seedDemo(createDb(pool));
    logger.info(
      {
        workspaceId: result.workspaceId,
        role: result.role,
        created: result.created,
        totals: result.totals,
        counter: result.counter,
        fixtureCaptureId: result.fixtureCaptureId,
      },
      "demo seed finished",
    );
  } catch (error) {
    logger.error({ err: error }, "demo seed failed");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
