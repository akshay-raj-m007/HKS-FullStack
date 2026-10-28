import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
const environment = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: "file:./test.db",
  JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
  OTP_HASH_SECRET: randomBytes(48).toString("hex"),
  PAYMENT_PROVIDER: "mock",
};
function run(args) {
  const result = spawnSync(process.execPath, args, {
    env: environment,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync("prisma/test.db")) writeFileSync("prisma/test.db", "");
run(["../node_modules/prisma/build/index.js", "generate"]);
run(["../node_modules/prisma/build/index.js", "migrate", "deploy"]);
run(["../node_modules/vitest/vitest.mjs", "run"]);
