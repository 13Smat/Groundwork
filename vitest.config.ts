import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["packages/**/*.test.ts", "packages/**/*.test.tsx", "apps/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "apps/api/test/rls.test.ts",
      "apps/api/test/auth.integration.test.ts",
    ],
  },
});
