import type { Job, PgBoss } from "pg-boss";
import type { Kysely } from "kysely";
import { z } from "zod/v4";

import type { Database } from "../db/types.js";
import { performProposalRender, type ProposalRenderMessage } from "./render.js";

export const PROPOSAL_RENDER_QUEUE = "proposal.render";

const messageSchema = z.object({
  proposalId: z.uuidv7(),
  workspaceId: z.uuidv7(),
  actorMemberId: z.uuidv7(),
});

export async function ensureProposalRenderQueue(boss: PgBoss): Promise<void> {
  const existing = await boss.getQueue(PROPOSAL_RENDER_QUEUE);
  if (!existing) {
    await boss.createQueue(PROPOSAL_RENDER_QUEUE, {
      retryLimit: 0,
      expireInSeconds: 120,
    });
  }
}

export async function enqueueProposalRender(
  boss: PgBoss,
  message: ProposalRenderMessage,
): Promise<void> {
  await ensureProposalRenderQueue(boss);
  const id = await boss.send(PROPOSAL_RENDER_QUEUE, message, { retryLimit: 0 });
  if (!id) {
    throw new Error("The proposal queue did not accept the job.");
  }
}

export async function registerProposalRenderWorker(
  boss: PgBoss,
  db: Kysely<Database>,
): Promise<void> {
  await ensureProposalRenderQueue(boss);
  await boss.work(PROPOSAL_RENDER_QUEUE, async (jobs: Job<ProposalRenderMessage>[]) => {
    for (const job of jobs) {
      const parsed = messageSchema.safeParse(job.data);
      if (!parsed.success) {
        throw new Error("Proposal render job was invalid.");
      }
      await performProposalRender(db, parsed.data);
    }
  });
}
