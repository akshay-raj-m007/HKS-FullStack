import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
for (const dir of ["backend", "frontend"]) {
  const dest = new URL("../" + dir + "/.env", import.meta.url);
  if (!existsSync(dest)) {
    let content = readFileSync(
      new URL("../" + dir + "/.env.example", import.meta.url),
      "utf8",
    );
    content = content
      .replace(
        "JWT_ACCESS_SECRET=",
        "JWT_ACCESS_SECRET=" + randomBytes(48).toString("hex"),
      )
      .replace(
        "OTP_HASH_SECRET=",
        "OTP_HASH_SECRET=" + randomBytes(48).toString("hex"),
      );
    writeFileSync(dest, content);
    console.log("Created " + dir + "/.env");
  }
}

// Create the local SQLite file before the Prisma CLI opens it on Windows.
const dbFile = new URL("../backend/prisma/dev.db", import.meta.url);
if (!existsSync(dbFile)) writeFileSync(dbFile, "");
