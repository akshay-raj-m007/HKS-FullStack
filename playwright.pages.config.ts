import { defineConfig } from "@playwright/test";

const basePath = process.env.VITE_BASE_PATH || "/loop-pickup/";
export default defineConfig({
  testDir: "./pages-e2e",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:4173" + basePath,
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run preview -w frontend -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173" + basePath,
    reuseExistingServer: false,
  },
});
