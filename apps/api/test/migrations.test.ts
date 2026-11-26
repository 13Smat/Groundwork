import { describe, expect, it } from "vitest";

import { listUpMigrations } from "../src/db/migrate.js";

describe("migration files", () => {
  it("lists up migrations and ignores down files", () => {
    expect(listUpMigrations()).toEqual([
      "0001_extensions_and_infra.sql",
      "0002_auth_workspaces.sql",
      "0003_imagery.sql",
      "0004_imagery_ingest.sql",
      "0005_crm_jobs.sql",
      "0006_catalog_recipes.sql",
      "0009_takeoff.sql",
      "0011_estimating.sql",
      "0012_detection.sql",
    ]);
  });
});
