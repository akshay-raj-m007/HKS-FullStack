import { createApp, logger } from "./app.js";
import { env } from "./config/env.js";
import { db } from "./repositories/db.js";
import { expireHolds } from "./jobs/expiry.js";
await db.$connect();
await expireHolds();
const server = createApp().listen(env.PORT, env.HOST, () =>
  logger.info(
    { port: env.PORT, paymentProvider: env.PAYMENT_PROVIDER },
    "Loop API ready",
  ),
);
const timer = setInterval(() => {
  expireHolds().catch(() => logger.error("Hold cleanup failed"));
}, 30000);
timer.unref();
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  server.close(() => {
    void db.$disconnect().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
