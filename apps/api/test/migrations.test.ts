import { describe, expect, it } from "vitest";

import { listUpMigrations } from "../src/db/migrate.js";

describe("migration files", () => {
  it("lists the infra migration and ignores the down file", () => {
    expect(listUpMigrations()).toEqual(["0001_extensions_and_infra.sql"]);
  });
});
