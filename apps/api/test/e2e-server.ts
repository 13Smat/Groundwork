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

loadLocalEnv();
await migrate("up");

const pool = createPool(readAppDatabaseUrl());
const authPool = createPool(readAuthDatabaseUrl());
const app = await buildApp({
  logger: createLogger("e2e"),
  database: { app: pool, auth: authPool },
});

const port = readPort(process.env.PORT);
const host = readHost(process.env.HOST ?? "127.0.0.1");
await app.listen({ port, host });
