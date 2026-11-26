import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/api/test/imagery-ingest.integration.test.ts",
      "apps/api/test/imagery.integration.test.ts",
    ],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
