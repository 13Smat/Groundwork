import type { Kysely } from "kysely";
import { describe, expect, it } from "vitest";

import type { Database } from "../src/db/types.js";
import { withWorkspaceContext } from "../src/db/workspace.js";
import { ProblemError } from "../src/errors.js";

describe("withWorkspaceContext", () => {
  it("rejects a workspace id that is not a UUIDv7 before it opens a transaction", async () => {
    const db = {
      transaction() {
        throw new Error("The database should not be touched.");
      },
    } as unknown as Kysely<Database>;

    await expect(withWorkspaceContext(db, "not-a-uuid", async () => "nope")).rejects.toBeInstanceOf(
      ProblemError,
    );
  });
});
