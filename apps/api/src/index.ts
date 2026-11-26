import { buildApp } from "./app.js";

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return 3001;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535. Received ${raw}.`);
  }
  return port;
}

function readHost(raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    return "0.0.0.0";
  }
  return raw.trim();
}

const app = await buildApp({ logger: true });
const port = readPort(process.env.PORT);
const host = readHost(process.env.HOST);

await app.listen({ port, host });
