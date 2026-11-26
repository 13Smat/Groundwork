import { isUuidV7 } from "@groundwork/shared";
import type { FastifyRequest } from "fastify";
import type { Kysely } from "kysely";
import type pg from "pg";

import type { Database } from "../db/types.js";
import { ProblemError } from "../errors.js";
import type { Auth } from "./auth.js";
import { requireActiveMember, requireImageryAdmin, requireSession } from "./guard.js";

export const WORKSPACE_HEADER = "x-workspace-id";

/** What a tile or captures request knows about the caller. */
export type ImageryAuth = {
  workspaceId: string;
};

export type ImageryAuthHook = (request: FastifyRequest) => Promise<ImageryAuth>;

/**
 * Session plus membership. A missing session is 401. A bad workspace header is
 * 400. A session that is not an active member of that workspace is 404.
 * Disabling the member deletes their sessions inside requireActiveMember.
 */
export function workspaceIdFromHeader(request: FastifyRequest): string {
  const raw = request.headers[WORKSPACE_HEADER];
  const workspaceId = Array.isArray(raw) ? raw[0] : raw;
  if (typeof workspaceId !== "string" || !isUuidV7(workspaceId)) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "x-workspace-id must be a UUIDv7.",
    });
  }
  return workspaceId;
}

export function createSessionImageryAuth(ctx: {
  db: Kysely<Database>;
  auth: Auth;
  authPool: pg.Pool;
}): ImageryAuthHook {
  return async (request) => {
    const session = await requireSession(ctx.auth, request.headers);
    const workspaceId = workspaceIdFromHeader(request);
    await requireActiveMember(ctx, session.id, workspaceId);
    return { workspaceId };
  };
}

/**
 * Same session and membership check as `createSessionImageryAuth`, then the
 * member's role. Owner and admin may edit imagery sources and start ingest.
 * Any other active role is 403.
 */
export function createAdminImageryAuth(ctx: {
  db: Kysely<Database>;
  auth: Auth;
  authPool: pg.Pool;
}): ImageryAuthHook {
  return async (request) => {
    const session = await requireSession(ctx.auth, request.headers);
    const workspaceId = workspaceIdFromHeader(request);
    const member = await requireActiveMember(ctx, session.id, workspaceId);
    requireImageryAdmin(member);
    return { workspaceId };
  };
}
