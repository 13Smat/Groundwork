import { sql } from "kysely";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readAppDatabaseUrl } from "../src/config.js";
import { createDb, createPool } from "../src/db/client.js";
import { migrate } from "../src/db/migrate.js";
import { seedDemo, type SeedCounts } from "../src/seed/demo.js";

const EMPTY: SeedCounts = {
  workspace: false,
  member: false,
  clients: 0,
  contacts: 0,
  locations: 0,
  jobs: 0,
  catalog: 0,
  takeoff: 0,
  recipes: 0,
};

let pool: pg.Pool | undefined;

beforeAll(async () => {
  await migrate("up");
  pool = createPool(readAppDatabaseUrl());
});

afterAll(async () => {
  await pool?.end();
});

describe("demo seed", () => {
  it("inserts the demo workspace once and hides it without workspace context", async () => {
    const db = createDb(pool ?? createPool(readAppDatabaseUrl()));
    const first = await seedDemo(db);
    const second = await seedDemo(db);

    expect(first.role).toBe("groundwork_app");
    expect(first.bypassrls).toBe(false);
    expect(first.fixtureCaptureId).toBe("018f5a00-0000-7000-8000-000000000108");
    expect(first.totals.clients).toBe(2);
    expect(first.totals.contacts).toBe(2);
    expect(first.totals.locations).toBe(2);
    expect(first.totals.jobs).toBe(1);
    expect(first.totals.catalog).toBeGreaterThan(0);
    expect(first.totals.takeoff).toBeGreaterThan(0);
    expect(first.totals.recipes).toBeGreaterThan(0);
    expect(second.created).toEqual(EMPTY);
    expect(second.totals).toEqual(first.totals);
    expect(second.counter).toBe(first.counter);
    if (first.created.jobs === 1) {
      expect(first.counter).toBe("1001");
      expect(first.created.catalog).toBe(first.totals.catalog);
    }

    const leaked = await db.transaction().execute(async (trx) => {
      const rows = await sql<{ n: number }>`select count(*)::int as n from client`.execute(trx);
      return Number(rows.rows[0]?.n ?? 0);
    });
    expect(leaked).toBe(0);
  });
});
