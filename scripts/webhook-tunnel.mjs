import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  createWriteStream,
  existsSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
const root = fileURLToPath(new URL("../", import.meta.url));
const env = parse(readFileSync(root + "backend/.env", "utf8"));
if (
  env.PAYMENT_PROVIDER !== "razorpay" ||
  !env.RAZORPAY_KEY_ID?.startsWith("rzp_test_") ||
  env.DATABASE_URL !== "file:./dev.db"
) {
  throw new Error(
    "This helper requires the local SQLite Razorpay test profile.",
  );
}
const binary = process.env.CLOUDFLARED_BIN || root + ".tools/cloudflared.exe";
if (!existsSync(binary))
  throw new Error(
    "Install cloudflared and set CLOUDFLARED_BIN to its executable path.",
  );
const port = Number(env.PORT || "4000");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid backend port");
const route = "/api/payments/webhook";
const upstream = "http://127.0.0.1:" + port + route;
const server = createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  if (req.url !== route || !["GET", "POST"].includes(req.method)) {
    res.writeHead(404).end(JSON.stringify({ error: "Not found" }));
    return;
  }
  if (req.method === "GET") {
    res.end(JSON.stringify({ status: "webhook endpoint ready" }));
    return;
  }
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 65536) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(chunk);
    }
    const headers = { "Content-Type": "application/json" };
    for (const name of ["x-razorpay-signature", "x-razorpay-event-id"]) {
      if (typeof req.headers[name] === "string")
        headers[name] = req.headers[name];
    }
    const response = await fetch(upstream, {
      method: "POST",
      headers,
      body: Buffer.concat(chunks),
      signal: AbortSignal.timeout(20000),
    });
    res.writeHead(response.status).end(await response.text());
  } catch {
    if (!res.destroyed)
      res
        .writeHead(502)
        .end(JSON.stringify({ error: "Local webhook unavailable" }));
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 5000;
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(4010, "127.0.0.1", resolve);
});
mkdirSync(root + ".tools", { recursive: true });
const log = createWriteStream(root + ".tools/webhook-tunnel.log");
const tunnel = spawn(
  binary,
  [
    "tunnel",
    "--url",
    "http://127.0.0.1:4010",
    "--no-autoupdate",
    "--protocol",
    "http2",
  ],
  { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
);
let published = false;
function output(chunk) {
  log.write(chunk);
  const url = chunk
    .toString()
    .match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (url && !published) {
    published = true;
    writeFileSync(root + ".tools/webhook-url.txt", url + route + "\n");
    console.log("Razorpay TEST webhook URL: " + url + route);
    console.log(
      "Keep this process and npm run dev running. Restarting this tunnel changes the URL.",
    );
  }
}
tunnel.stdout.on("data", output);
tunnel.stderr.on("data", output);
tunnel.on("error", () => {
  console.error("Could not start cloudflared");
  server.close();
  log.end();
  process.exitCode = 1;
});
tunnel.on("exit", (code) => {
  server.close();
  log.end();
  if (code) {
    console.error("Tunnel stopped; see .tools/webhook-tunnel.log");
    process.exitCode = code;
  }
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    tunnel.kill();
    server.close();
  });
console.log("Starting a temporary HTTPS tunnel for the webhook route only...");
