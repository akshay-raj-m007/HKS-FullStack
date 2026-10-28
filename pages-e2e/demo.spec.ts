import { test, expect } from "@playwright/test";

test("Pages subpath supports refresh, navigation and checkout without a backend", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (/\/api(?:\/|$)/.test(new URL(request.url()).pathname))
      apiRequests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(
    page.getByRole("heading", { name: "Good things start with a pickup." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "My pickups", exact: true }).click();
  await page.getByRole("link", { name: "View details" }).first().click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "GreenCycle Services", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Collection", exact: true }).click();
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
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /^Pay / }).click();
  await page
    .getByRole("button", { name: "Simulate successful payment" })
    .click();
  await expect(
    page.getByRole("heading", { name: "A little less waste is on its way." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "My pickups", exact: true }).click();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "A little less waste is on its way." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Open interactive demo" }).click();
  await expect(
    page.getByRole("link", { name: "My pickups", exact: true }),
  ).toBeVisible();
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});
