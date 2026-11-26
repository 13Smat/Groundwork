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

export type DbSettings = {
  workspaceId?: string;
  userId?: string;
  inviteId?: string;
};

function requireUuidV7(value: string, label: string): void {
  if (!isUuidV7(value)) {
    throw new ProblemError({
      status: 400,
      title: "Bad Request",
      detail: `${label} must be a UUIDv7.`,
    });
  }
}

async function assertTenantRole(trx: Transaction<Database>): Promise<void> {
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
}

/**
 * Run `fn` in a transaction with the given settings for that transaction only
 * (`set_config` third argument true, the same scope as SET LOCAL).
 * The connection must not be a superuser and must not bypass row security.
 */
export async function withDbContext<T>(
  db: Kysely<Database>,
  settings: DbSettings,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  if (settings.workspaceId !== undefined) {
    requireUuidV7(settings.workspaceId, "Workspace id");
  }
  if (settings.userId !== undefined) {
    requireUuidV7(settings.userId, "User id");
  }
  if (settings.inviteId !== undefined) {
    requireUuidV7(settings.inviteId, "Invite id");
  }

  return db.transaction().execute(async (trx) => {
    await assertTenantRole(trx);
    if (settings.workspaceId) {
      await sql`select set_config('app.workspace_id', ${settings.workspaceId}, true)`.execute(trx);
    }
    if (settings.userId) {
      await sql`select set_config('app.user_id', ${settings.userId}, true)`.execute(trx);
    }
    if (settings.inviteId) {
      await sql`select set_config('app.invite_id', ${settings.inviteId}, true)`.execute(trx);
    }
    return fn(trx);
  });
}

/**
 * Run `fn` in a transaction with `app.workspace_id` set for that transaction
 * only. The connection must not be a superuser and must not bypass row security.
 */
export function withWorkspaceContext<T>(
  db: Kysely<Database>,
  workspaceId: string,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return withDbContext(db, { workspaceId }, fn);
}

/**
 * Same tenant connection as `withWorkspaceContext`, plus `app.imagery_admin=on`
 * for this transaction only. Call it only after `requireImageryAdmin`. The
 * setting is what lets the app role write a global imagery row. ADR 0008.
 */
export function withImageryAdminContext<T>(
  db: Kysely<Database>,
  workspaceId: string,
  fn: (trx: Transaction<Database>) => Promise<T>,
): Promise<T> {
  return withDbContext(db, { workspaceId }, async (trx) => {
    await sql`select set_config('app.imagery_admin', 'on', true)`.execute(trx);
    return fn(trx);
  });
}
