import { test, expect, Page } from "@playwright/test";
import { readFileSync } from "node:fs";
async function login(page: Page, phone: string) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Get verification code" }).click();
  await expect(page.getByLabel("Verification code")).toBeVisible();
  let code = "";
  await expect
    .poll(() => {
      const lines = readFileSync("test-results/api.log", "utf8").split("\n");
      const line = lines.findLast((l) =>
        l.includes("[DEV OTP] " + phone + " => "),
      );
      code = line?.match(/=> (\d{6})/)?.[1] ?? "";
      return code;
    })
    .toMatch(/^\d{6}$/);
  await page.getByLabel("Verification code").fill(code);
  await page.getByRole("button", { name: "Verify & continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Good things start with a pickup." }),
  ).toBeVisible();
}
async function addAddress(
  page: Page,
  label: string,
  street: string,
  postalCode = "560001",
) {
  await page.getByRole("link", { name: "Addresses", exact: true }).click();
  await page.getByRole("button", { name: "Add address", exact: true }).click();
  await page.getByLabel("Address label").fill(label);
  await page.getByLabel("Contact name").fill("Acceptance Resident");
  await page.getByLabel("Street address", { exact: true }).fill(street);
  await page.getByLabel("Postal code").fill(postalCode);
  await page.getByRole("button", { name: "Save address", exact: true }).click();
  await expect(
    page.getByText("Your pickup address has been saved."),
  ).toBeVisible();
}
async function book(page: Page, provider: string, label: string) {
  await page.getByRole("link", { name: "Collection", exact: true }).click();
  await page.getByRole("button", { name: "Plastic", exact: true }).click();
  const card = page.locator("article").filter({
    has: page.getByRole("heading", { name: provider, exact: true }),
  });
  await card.getByRole("link", { name: "View slots" }).click();
  await page.getByLabel("Pickup address").selectOption({ label });
  await page.getByRole("checkbox", { name: "Plastic", exact: true }).check();
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(
    page.getByRole("heading", { name: "A fresh start, all booked in." }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Pay / }).click();
  await page
    .getByRole("button", { name: "Simulate successful payment" })
    .click();
  await expect(page.getByText("PROCESSING", { exact: true })).toBeVisible();
  await expect(page.getByText("PAID", { exact: true })).toBeVisible();
}
async function sessionToken(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "Loop",
      },
      body: "{}",
    });
    return (await response.json()).data.accessToken as string;
  });
}
test("two-user acceptance flow and responsive UI", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page, "+919876543210");
  await addAddress(page, "Home", "12 Garden Road");
  await page.getByRole("link", { name: "Collection", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "GreenCycle Services", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/discovery-desktop.png",
    fullPage: true,
  });
  await book(page, "GreenCycle Services", "Home · 12 Garden Road, 560001");
  const firstId = page.url().split("/").at(-1)!;
  const aToken = await sessionToken(page);
  const first = await (
    await page.request.get("http://localhost:4001/api/orders/" + firstId, {
      headers: { Authorization: "Bearer " + aToken },
    })
  ).json();
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await login(other, "+919876543211");
  await addAddress(other, "Home B", "14 Garden Road");
  const bToken = await sessionToken(other);
  const bAddresses = await (
    await other.request.get("http://localhost:4001/api/addresses", {
      headers: { Authorization: "Bearer " + bToken },
    })
  ).json();
  const denied = await other.request.post(
    "http://localhost:4001/api/bookings/hold",
    {
      headers: {
        Authorization: "Bearer " + bToken,
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {
        providerId: first.data.providerId,
        slotId: first.data.slotId,
        addressId: bAddresses.data[0].id,
        wasteTypes: ["PLASTIC"],
      },
    },
  );
  expect(denied.status()).toBe(409);
  expect(
    (
      await other.request.get("http://localhost:4001/api/orders/" + firstId, {
        headers: { Authorization: "Bearer " + bToken },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.get(
        "http://localhost:4001/api/addresses/" + bAddresses.data[0].id,
        { headers: { Authorization: "Bearer " + aToken } },
      )
    ).status(),
  ).toBe(404);
  await addAddress(page, "Work", "85 Office Road", "560038");
  await book(page, "Urban Recycling", "Work · 85 Office Road, 560038");
  await page.getByRole("link", { name: "My pickups", exact: true }).click();
  await expect(page.getByText("PROCESSING", { exact: true })).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/orders-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Collection", exact: true }).click();
  await page.screenshot({
    path: "test-results/discovery-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await otherContext.close();
});
