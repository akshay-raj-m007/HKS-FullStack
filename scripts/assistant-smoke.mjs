import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.execPath,
  [
    "../node_modules/tsx/dist/cli.mjs",
    "scripts/assistant-smoke.ts",
    ...process.argv.slice(2),
  ],
  { cwd: "backend", env: process.env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
