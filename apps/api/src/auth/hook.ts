import { isUuidV7 } from "@groundwork/shared";
import type { FastifyRequest } from "fastify";

import { ProblemError } from "../errors.js";

export const WORKSPACE_HEADER = "x-workspace-id";

/** What a tile or captures request knows about the caller. Auth will replace the stub. */
export type ImageryAuth = {
  workspaceId: string;
};

export type ImageryAuthHook = (request: FastifyRequest) => Promise<ImageryAuth>;

/**
 * Temporary stand-in for the session middleware. Auth and Workspaces owns the
 * real hook. This reads `x-workspace-id` and checks that it is a UUIDv7.
 * It does not create a session and it does not trust a body field.
 */
export function stubImageryAuth(request: FastifyRequest): Promise<ImageryAuth> {
  const raw = request.headers[WORKSPACE_HEADER];
  const workspaceId = Array.isArray(raw) ? raw[0] : raw;
  if (workspaceId === undefined || !isUuidV7(workspaceId)) {
    throw new ProblemError({
      status: 401,
      title: "Unauthorized",
      detail: "A workspace id is required. Auth will replace this stub.",
    });
  }
  return Promise.resolve({ workspaceId });
}
