import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  createWriteStream,
  existsSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const env = {
  ...process.env,
  NODE_ENV: "development",
  PORT: "4001",
  FRONTEND_URL: "http://localhost:5174",
  DATABASE_URL: "file:./e2e.db",
  JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
  OTP_HASH_SECRET: randomBytes(48).toString("hex"),
  PAYMENT_PROVIDER: "mock",
  API_PROXY_TARGET: "http://localhost:4001",
};
mkdirSync(root + "test-results", { recursive: true });
if (!existsSync(root + "backend/prisma/e2e.db"))
  writeFileSync(root + "backend/prisma/e2e.db", "");
for (const args of [
  [root + "node_modules/prisma/build/index.js", "migrate", "deploy"],
  [root + "node_modules/tsx/dist/cli.mjs", "tests/e2e-seed.ts"],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: root + "backend",
    env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const log = createWriteStream(root + "test-results/api.log");
const api = spawn(
  process.execPath,
  [root + "node_modules/tsx/dist/cli.mjs", "src/server.ts"],
  { cwd: root + "backend", env, stdio: ["ignore", "pipe", "pipe"] },
);
api.stdout.on("data", (chunk) => {
  log.write(chunk);
  process.stdout.write(chunk);
});
api.stderr.on("data", (chunk) => process.stderr.write(chunk));
const frontend = spawn(
  process.execPath,
  [
    root + "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5174",
    "--strictPort",
  ],
  { cwd: root + "frontend", env, stdio: "inherit" },
);
function stop() {
  api.kill();
  frontend.kill();
  log.end();
}
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
api.on("exit", (code) => {
  if (code) {
    stop();
    process.exit(code);
  }
});
frontend.on("exit", (code) => {
  if (code) {
    stop();
    process.exit(code);
  }
});
