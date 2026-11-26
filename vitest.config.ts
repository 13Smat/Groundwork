import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "apps/api/test/rls.test.ts",
      "apps/api/test/auth.integration.test.ts",
      "apps/api/test/catalog.integration.test.ts",
      "apps/api/test/imagery.integration.test.ts",
      "apps/api/test/imagery-ingest.integration.test.ts",
      "apps/api/test/crm.integration.test.ts",
      "apps/api/test/takeoff.integration.test.ts",
      "apps/api/test/assist-review.integration.test.ts",
      "apps/api/test/estimating.integration.test.ts",
      "apps/api/test/proposals.integration.test.ts",
      "apps/api/test/esign.integration.test.ts",
      "apps/api/test/assist.integration.test.ts",
      "apps/api/test/seed.integration.test.ts",
    ],
  },
});
