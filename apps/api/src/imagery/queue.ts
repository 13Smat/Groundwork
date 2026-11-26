import type { Job, PgBoss } from "pg-boss";
import type { Kysely } from "kysely";
import { z } from "zod/v4";

import type { Database } from "../db/types.js";
import type { IngestDispatch } from "./ingest-service.js";
import { runImageryIngestJob } from "./ingest-service.js";

export const IMAGERY_INGEST_QUEUE = "imagery.ingest";

const messageSchema = z.object({
  ingestJobId: z.uuidv7(),
  workspaceId: z.uuidv7(),
});

export async function ensureImageryIngestQueue(boss: PgBoss): Promise<void> {
  const existing = await boss.getQueue(IMAGERY_INGEST_QUEUE);
  if (!existing) {
    await boss.createQueue(IMAGERY_INGEST_QUEUE, {
      retryLimit: 0,
      expireInSeconds: 900,
    });
  }
}

export function imageryIngestDispatch(boss: PgBoss): IngestDispatch {
  return async (message) => {
    const id = await boss.send(IMAGERY_INGEST_QUEUE, message, { retryLimit: 0 });
    if (!id) {
      throw new Error("The ingest queue did not accept the job.");
    }
  };
}

export async function registerImageryIngestWorker(
  boss: PgBoss,
  db: Kysely<Database>,
): Promise<void> {
  await ensureImageryIngestQueue(boss);
  await boss.work(
    IMAGERY_INGEST_QUEUE,
    async (jobs: Job<{ ingestJobId?: string; workspaceId?: string }>[]) => {
      for (const job of jobs) {
        const parsed = messageSchema.safeParse(job.data);
        if (!parsed.success) {
          continue;
        }
        await runImageryIngestJob(db, parsed.data);
      }
    },
  );
}
