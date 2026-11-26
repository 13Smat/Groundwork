import pg from "pg";

import { APP_ROLE, AUTH_ROLE } from "../config.js";

const { escapeLiteral } = pg;

/**
 * Login roles are not superusers and cannot bypass row security.
 * CREATE ROLE cannot run inside a transaction, so this stays outside one.
 */
export async function ensureLoginRole(
  pool: pg.Pool,
  role: string,
  password: string,
): Promise<void> {
  if (!/^[a-z_]+$/.test(role)) {
    throw new Error(`Refusing to create a role named ${role}.`);
  }
  const client = await pool.connect();
  try {
    const existing = await client.query("select 1 from pg_roles where rolname = $1", [role]);
    if ((existing.rowCount ?? 0) === 0) {
      await client.query(
        `create role ${role} login nosuperuser nobypassrls nocreatedb nocreaterole`,
      );
    } else {
      await client.query(
        `alter role ${role} with login nosuperuser nobypassrls nocreatedb nocreaterole`,
      );
    }
    await client.query(`alter role ${role} password ${escapeLiteral(password)}`);
  } finally {
    client.release();
  }
}

export function ensureAppRole(pool: pg.Pool, password: string): Promise<void> {
  return ensureLoginRole(pool, APP_ROLE, password);
}

export function ensureAuthRole(pool: pg.Pool, password: string): Promise<void> {
  return ensureLoginRole(pool, AUTH_ROLE, password);
}
