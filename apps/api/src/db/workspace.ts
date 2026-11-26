import { isUuidV7 } from "@groundwork/shared";
import { sql, type Kysely, type Transaction } from "kysely";

import { ProblemError } from "../errors.js";
import type { Database } from "./types.js";

export class TenantRoleError extends Error {
  constructor(role: string) {
    super(`Tenant queries must use a role without superuser or BYPASSRLS. Connected as ${role}.`);
    this.name = "TenantRoleError";
  }
}

/**
 * Run `fn` in a transaction with `app.workspace_id` set for that transaction
 * only (`set_config` third argument true, the same scope as SET LOCAL).
 * The connection must not be a superuser and must not bypass row security.
 */
export async function withWorkspaceContext<T>(
  db: Kysely<Database>,
  workspaceId: string,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  if (!isUuidV7(workspaceId)) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: "Workspace id must be a UUIDv7.",
    });
  }

  return db.transaction().execute(async (trx) => {
    const role = await sql<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>`
      select current_user, rolsuper, rolbypassrls
      from pg_roles
      where rolname = current_user
    `.execute(trx);
    const row = role.rows[0];
    if (!row || row.rolsuper || row.rolbypassrls) {
      throw new TenantRoleError(row?.current_user ?? "unknown");
    }
    await sql`select set_config('app.workspace_id', ${workspaceId}, true)`.execute(trx);
    return fn(trx);
  });
}
