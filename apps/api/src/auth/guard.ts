import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import type { Kysely, Selectable } from "kysely";
import type pg from "pg";

import type { Database } from "../db/types.js";
import { withDbContext } from "../db/workspace.js";
import { ProblemError } from "../errors.js";
import type { Auth } from "./auth.js";

export type SessionUser = {
  id: string;
  email: string;
  sessionId: string;
  activeWorkspaceId: string | null;
};

export type MemberRow = Selectable<Database["member"]>;

type MembershipDb = {
  db: Kysely<Database>;
  authPool: pg.Pool;
};

export async function requireSession(
  auth: Auth,
  headers: FastifyRequest["headers"],
): Promise<SessionUser> {
  const result = await auth.api.getSession({
    headers: fromNodeHeaders(headers),
  });
  if (!result?.user?.id || !result.session?.id) {
    throw new ProblemError({
      status: 401,
      title: "Unauthorized",
      detail: "Sign in to continue.",
    });
  }
  return {
    id: result.user.id,
    email: result.user.email,
    sessionId: result.session.id,
    activeWorkspaceId: result.session.activeOrganizationId ?? null,
  };
}

/**
 * Active members pass. Someone who is not a member, or whose invite is still
 * open, gets 404 so the workspace is not confirmed. A disabled member loses
 * every session and the request is 401.
 */
export async function requireActiveMember(
  ctx: MembershipDb,
  userId: string,
  workspaceId: string,
): Promise<MemberRow> {
  const rows = await withDbContext(ctx.db, { userId }, async (trx) => {
    return trx.selectFrom("member").selectAll().where("user_id", "=", userId).execute();
  });
  const member = rows.find((row) => row.workspace_id === workspaceId && row.status !== "revoked");
  if (!member) {
    throw new ProblemError({
      status: 404,
      title: "Not Found",
      detail: "That workspace was not found.",
    });
  }
  if (member.status === "disabled") {
    await ctx.authPool.query("delete from session where user_id = $1", [userId]);
    throw new ProblemError({
      status: 401,
      title: "Unauthorized",
      detail: "This membership is disabled.",
    });
  }
  if (member.status !== "active") {
    throw new ProblemError({
      status: 404,
      title: "Not Found",
      detail: "That workspace was not found.",
    });
  }
  return member;
}
