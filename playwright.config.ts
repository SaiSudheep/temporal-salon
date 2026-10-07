import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3100",
    viewport: { width: 1440, height: 1080 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node --import tsx src/api.ts",
    url: "http://localhost:3100",
    env: { PORT: "3100", SALON_WORKFLOW_ID: `juniper-browser-${Date.now()}` },
    reuseExistingServer: false,
  },
});
