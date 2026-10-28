import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://localhost:5174",
    reuseExistingServer: false,
    timeout: 180000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
