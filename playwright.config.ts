import { defineConfig, devices } from "@playwright/test";

const serverEnv = {
  ...process.env,
  PORT: "3001",
  HOST: "127.0.0.1",
  BETTER_AUTH_URL: "http://127.0.0.1:5173",
  WEB_ORIGIN: "http://127.0.0.1:5173",
};

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command:
        "pnpm --filter @groundwork/shared build && pnpm --filter @groundwork/api exec tsx test/e2e-server.ts",
      url: "http://127.0.0.1:3001/healthz",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: serverEnv,
    },
    {
      command: "pnpm --filter @groundwork/web dev --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
