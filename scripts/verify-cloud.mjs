import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const origin = (
  process.env.CLOUD_URL || "https://hks-fullstack.vercel.app"
).replace(/\/$/, "");
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  headless: true,
});
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(90000);
const errors = [];
const crossSiteApiRequests = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (new URL(request.url()).hostname.endsWith(".onrender.com"))
    crossSiteApiRequests.push(request.url());
});
const visible = (locator) => locator.waitFor({ state: "visible" });
try {
  await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("button", { name: "Open interactive demo" }).click();
  await visible(
    page.getByRole("heading", { name: "Good things start with a pickup." }),
  );
  const cookie = (await context.cookies()).find(
    (entry) => entry.name === "refreshToken",
  );
  assert(cookie?.secure && cookie.httpOnly && cookie.sameSite === "Strict");
  assert.equal(cookie.domain, new URL(origin).hostname);
  await page.reload();
  await visible(
    page.getByRole("heading", { name: "Good things start with a pickup." }),
  );
  assert.notEqual(
    (await context.cookies()).find((entry) => entry.name === "refreshToken")
      ?.value,
    cookie.value,
  );
  console.log(
    "PASS: public Vercel frontend → Render → Neon, Secure/HttpOnly same-origin cookie and refresh rotation",
  );
  await page
    .locator("article")
    .filter({
      has: page.getByRole("heading", {
        name: "GreenCycle Services",
        exact: true,
      }),
    })
    .getByRole("link", { name: "View slots" })
    .click();
  await page.getByLabel("Pickup address").selectOption({ index: 1 });
  await page.getByRole("checkbox", { name: "Paper", exact: true }).check();
  await page.getByRole("radio").first().check();
  const held = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/bookings/hold" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Continue to payment" }).click();
  const heldResponse = await held;
  assert.equal(heldResponse.status(), 201);
  const booking = (await heldResponse.json()).data;
  await page.getByRole("button", { name: /^Pay / }).click();
  await page
    .getByRole("button", { name: "Simulate successful payment" })
    .click();
  await visible(
    page.getByRole("heading", { name: "A little less waste is on its way." }),
  );
  await page.reload();
  await visible(
    page.getByRole("heading", { name: "A little less waste is on its way." }),
  );
  console.log(
    "PASS: paid sample pickup persists across reload on the production URL",
  );
  mkdirSync("test-results", { recursive: true });
  await page.screenshot({
    path: "test-results/cloud-demo.png",
    fullPage: true,
  });
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  otherPage.setDefaultTimeout(90000);
  await otherPage.goto(origin);
  await otherPage
    .getByRole("button", { name: "Open interactive demo" })
    .click();
  await visible(
    otherPage.getByRole("heading", {
      name: "Good things start with a pickup.",
    }),
  );
  const denied = otherPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/orders/" + booking.id,
  );
  await otherPage.goto(origin + "/orders/" + booking.id);
  assert.equal((await denied).status(), 404);
  console.log(
    "PASS: another browser guest cannot access the first guest's pickup",
  );
  await other.close();
  await page.getByRole("button", { name: "Sign out" }).click();
  await visible(page.getByRole("button", { name: "Open interactive demo" }));
  assert.equal(
    (await context.cookies()).some((entry) => entry.name === "refreshToken"),
    false,
  );
  assert.deepEqual(crossSiteApiRequests, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: sign-out clears the cookie; no cross-site API calls or browser exceptions",
  );
} finally {
  await browser.close();
}
