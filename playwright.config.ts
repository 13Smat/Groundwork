import { defineConfig, devices } from "@playwright/test";

const serverEnv = {
  ...process.env,
  PORT: "3001",
  HOST: "127.0.0.1",
  BETTER_AUTH_URL: "http://127.0.0.1:5173",
  WEB_ORIGIN: "http://127.0.0.1:5173",
  GROUNDWORK_AI_ASSIST: "1",
  CV_SERVICE_URL: "http://127.0.0.1:8090",
  CV_BACKEND: "mock",
};

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [
        "**/takeoff-editor.spec.ts",
        "**/takeoff-assist.spec.ts",
        "**/mvp-slice.spec.ts",
      ],
    },
    {
      name: "chromium-gl",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1100 },
      },
      testMatch: ["**/takeoff-editor.spec.ts", "**/takeoff-assist.spec.ts", "**/mvp-slice.spec.ts"],
    },
  ],
  webServer: [
    {
      command: "sh scripts/e2e-cv.sh",
      url: "http://127.0.0.1:8090/healthz",
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "pnpm build:api-deps && pnpm --filter @groundwork/api exec tsx test/e2e-server.ts",
      url: "http://127.0.0.1:3001/healthz",
      timeout: 180_000,
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
