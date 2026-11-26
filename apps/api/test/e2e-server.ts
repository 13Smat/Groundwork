import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildApp } from "../src/app.js";
import {
  loadLocalEnv,
  readAppDatabaseUrl,
  readAuthDatabaseUrl,
  readHost,
  readPort,
} from "../src/config.js";
import { createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { createLogger } from "../src/logging.js";
import { ensureBucket, putObject } from "../src/storage/s3.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function prepareAssistFixture(): Promise<void> {
  if (process.env.GROUNDWORK_AI_ASSIST !== "1") {
    return;
  }
  const meta = JSON.parse(
    readFileSync(path.join(root, "db/seed/fixtures/rgbir-cog.json"), "utf8"),
  ) as {
    key: string;
  };
  await ensureBucket();
  await putObject({
    storageKey: meta.key,
    body: readFileSync(path.join(root, "db/seed/fixtures/rgbir-cog.tif")),
    mime: "image/tiff",
  });
  const python = process.env.IMAGERY_INGEST_PYTHON || path.join(root, ".venv-imagery/bin/python");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, ["-c", "import rasterio"], { stdio: "inherit" });
    child.on("error", () => {
      reject(new Error(`Could not start ${python}. Run sh scripts/ensure-imagery-venv.sh.`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error("rasterio did not import. Run sh scripts/ensure-imagery-venv.sh."));
    });
  });
}

loadLocalEnv();
await migrate("up");
await prepareAssistFixture();

const pool = createPool(readAppDatabaseUrl());
const authPool = createPool(readAuthDatabaseUrl());
const app = await buildApp({
  logger: createLogger("e2e"),
  database: { app: pool, auth: authPool },
});

const port = readPort(process.env.PORT);
const host = readHost(process.env.HOST ?? "127.0.0.1");
await app.listen({ port, host });
