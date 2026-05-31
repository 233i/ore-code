import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./smoke",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:1430",
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    trace: "retain-on-failure"
  },
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 1430 --strictPort",
    url: "http://127.0.0.1:1430",
    reuseExistingServer: true,
    timeout: 120_000
  }
});
