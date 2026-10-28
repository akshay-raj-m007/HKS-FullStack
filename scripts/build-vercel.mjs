import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.execPath,
  [process.env.npm_execpath, "run", "build", "-w", "frontend"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_DEMO_MODE: "false",
      VITE_PUBLIC_DEMO_MODE: "true",
      VITE_API_URL: "/api",
      VITE_ROUTER_MODE: "browser",
      VITE_BASE_PATH: "/",
    },
  },
);
process.exit(result.status ?? 1);
