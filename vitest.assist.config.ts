import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/api/test/assist.integration.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
