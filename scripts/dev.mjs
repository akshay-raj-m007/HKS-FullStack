import { createServer } from "node:net";
import concurrently from "concurrently";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const root = fileURLToPath(new URL("../", import.meta.url));
let env = {};
try {
  env = parse(readFileSync(new URL("../backend/.env", import.meta.url)));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const apiPort = Number(process.env.PORT ?? env.PORT ?? "4000");
const apiHost = process.env.HOST ?? env.HOST ?? "127.0.0.1";
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
  console.error("Invalid backend PORT: use an integer between 1 and 65535.");
  process.exit(1);
}

async function available(port, host) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

const ports = [apiPort, 5173];
const checks = await Promise.all([
  available(apiPort, apiHost),
  available(5173, "127.0.0.1"),
]);
const occupied = ports.filter((_, index) => !checks[index]);
if (occupied.length) {
  console.error(
    `Loop did not start: port(s) ${occupied.join(", ")} already in use.`,
  );
  console.error(
    "Stop the existing dev run with Ctrl+C in its terminal, then run npm run dev once. No new API or frontend was started.",
  );
  process.exit(1);
}

console.log(
  "Loop: http://127.0.0.1:5173. Development OTPs appear in this terminal as [DEV OTP]; no SMS is sent.",
);
const proxyHost =
  apiHost === "0.0.0.0"
    ? "127.0.0.1"
    : apiHost === "::"
      ? "[::1]"
      : apiHost.includes(":")
        ? `[${apiHost}]`
        : apiHost;
const { result } = concurrently(
  [
    { command: "npm run dev -w backend", name: "api", prefixColor: "green" },
    {
      command: "npm run dev -w frontend",
      name: "web",
      prefixColor: "blue",
      env: {
        API_PROXY_TARGET:
          process.env.API_PROXY_TARGET ?? `http://${proxyHost}:${apiPort}`,
      },
    },
  ],
  {
    cwd: root,
    killOthersOn: ["success", "failure"],
  },
);
// Concurrently owns signal handling and kills descendant process trees on exit.
try {
  await result;
} catch {
  process.exitCode = 1;
}
