import { describe, expect, it } from "vitest";

import { listUpMigrations } from "../src/db/migrate.js";

describe("migration files", () => {
  it("lists up migrations and ignores down files", () => {
    expect(listUpMigrations()).toEqual(["0001_extensions_and_infra.sql", "0003_imagery.sql"]);
  });
});
