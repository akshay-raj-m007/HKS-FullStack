import { config } from "dotenv";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

config({ path: "backend/.env", quiet: true });
config({
  path: existsSync(".env") ? ".env" : ".env.local",
  override: true,
  quiet: true,
});
const environment = {
  ...process.env,
  DIRECT_DATABASE_URL:
    process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_DATABASE_URL,
};
if (
  !environment.DATABASE_URL?.startsWith("postgres") ||
  !environment.DIRECT_DATABASE_URL
) {
  throw new Error(
    "Run neon init/deploy or neon env pull first. Both pooled and direct Neon URLs are required.",
  );
}
const schema = "backend/prisma/postgres/schema.prisma";
const tasks = {
  generate: [
    "node_modules/prisma/build/index.js",
    "generate",
    "--schema",
    schema,
  ],
  migrate: [
    "node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
    "--schema",
    schema,
  ],
  seed: ["node_modules/tsx/dist/cli.mjs", "backend/prisma/seed.ts"],
  verify: [
    "node_modules/tsx/dist/cli.mjs",
    "backend/scripts/verify-postgres.ts",
  ],
  start: ["backend/dist/src/server.js"],
};
const task = process.argv[2];
if (!(task in tasks))
  throw new Error("Choose generate, migrate, seed, verify or start.");
if (task === "verify") {
  environment.NODE_ENV = "test";
  environment.PUBLIC_DEMO_MODE = "true";
}
if (task === "start") environment.PUBLIC_DEMO_MODE = "true";
const result = spawnSync(process.execPath, tasks[task], {
  env: environment,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
