import pg from "pg";

import { APP_ROLE } from "../config.js";

const { escapeLiteral } = pg;

/**
 * The app role is not a superuser and cannot bypass row security.
 * CREATE ROLE cannot run inside a transaction, so this stays outside one.
 */
export async function ensureAppRole(pool: pg.Pool, password: string): Promise<void> {
  const client = await pool.connect();
  try {
    const existing = await client.query("select 1 from pg_roles where rolname = $1", [APP_ROLE]);
    if ((existing.rowCount ?? 0) === 0) {
      await client.query(
        `create role ${APP_ROLE} login nosuperuser nobypassrls nocreatedb nocreaterole`,
      );
    } else {
      await client.query(
        `alter role ${APP_ROLE} with login nosuperuser nobypassrls nocreatedb nocreaterole`,
      );
    }
    await client.query(`alter role ${APP_ROLE} password ${escapeLiteral(password)}`);
  } finally {
    client.release();
  }
}
