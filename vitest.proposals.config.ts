import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/api/test/proposals.integration.test.ts",
      "apps/api/test/esign.integration.test.ts",
    ],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
