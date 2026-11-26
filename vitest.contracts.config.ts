import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/api/test/tenant-isolation.integration.test.ts",
      "apps/api/test/problem-contract.integration.test.ts",
    ],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120_000,
    hookTimeout: 30_000,
  },
});
