import { describe, expect, it } from "vitest";
import request from "supertest";
import { isAllowedOrigin } from "../src/security/origin.js";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
describe("local frontend origin aliases", () => {
  it.each([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
  ])("accepts same-port loopback in development: %s", (origin) => {
    expect(isAllowedOrigin(origin, "http://localhost:5173", true)).toBe(true);
  });
  it.each([
    "http://localhost:5174",
    "https://localhost:5173",
    "http://localhost.evil.example:5173",
    "http://192.168.1.10:5173",
    "null",
    "http://127.0.0.1:5173/path",
  ])("rejects different origins: %s", (origin) => {
    expect(isAllowedOrigin(origin, "http://localhost:5173", true)).toBe(false);
  });
  it("keeps production exact-match and never aliases a non-loopback configured host", () => {
    expect(
      isAllowedOrigin("http://127.0.0.1:5173", "http://localhost:5173", false),
    ).toBe(false);
    expect(
      isAllowedOrigin("https://app.example", "https://app.example", false),
    ).toBe(true);
    expect(
      isAllowedOrigin("http://127.0.0.1:5173", "http://app.example:5173", true),
    ).toBe(false);
  });
  it("lets the Vite printed URL reach OTP validation and reflects its CORS origin", async () => {
    const previous = env.NODE_ENV;
    env.NODE_ENV = "development";
    try {
      const app = createApp();
      const response = await request(app)
        .post("/api/auth/request-otp")
        .set("Origin", "http://127.0.0.1:5173")
        .send({ phone: "invalid" });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("VALIDATION_ERROR");
      expect(response.headers["access-control-allow-origin"]).toBe(
        "http://127.0.0.1:5173",
      );
      const rejected = await request(app)
        .post("/api/auth/request-otp")
        .set("Origin", "http://localhost:5174")
        .send({ phone: "invalid" });
      expect(rejected.status).toBe(403);
      expect(rejected.body.error.code).toBe("ORIGIN_REJECTED");
    } finally {
      env.NODE_ENV = previous;
    }
  });
});
