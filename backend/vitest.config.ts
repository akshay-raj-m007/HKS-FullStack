import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    pool: "threads",
    environment: "node",
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
  },
});
