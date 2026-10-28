import { test, expect } from "@playwright/test";
import sharp from "sharp";

test("Ask Loop desktop/mobile photo review and existing booking draft", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const address = {
    id: "33333333-3333-4333-8333-333333333333",
    label: "Home",
    contactName: "Resident",
    contactPhone: "+919876543210",
    addressLine1: "12 Garden Road",
    addressLine2: "",
    city: "Bengaluru",
    state: "Karnataka",
    postalCode: "560001",
  };
  const provider = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "GreenCycle Services",
    description: "Local collection",
    price: 14900,
    currency: "INR",
    rating: 4.8,
    color: "sage",
    wasteTypes: [{ wasteType: "PAPER" }, { wasteType: "PLASTIC" }],
    serviceAreas: [{ city: "Bengaluru", postalCode: "560001" }],
    slots: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        providerId: "11111111-1111-4111-8111-111111111111",
        startAt: "2035-10-01T10:30:00Z",
        endAt: "2035-10-01T11:30:00Z",
        status: "AVAILABLE",
      },
    ],
  };
  let searchMaterials: string[] = [];
  let mutations = 0;
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname.replace("/api", "");
      let data: unknown;
      if (path === "/auth/refresh")
        data = {
          accessToken: "mock-browser-session",
          user: {
            id: "10000000-0000-4000-8000-000000000001",
            phone: "+919876543210",
          },
        };
      else if (path === "/assistant/capabilities")
        data = {
          enabled: true,
          chat: true,
          photo: true,
          reason: null,
          categories: ["PAPER", "PLASTIC"],
          imageMaxBytes: 2097152,
        };
      else if (path === "/addresses") data = [address];
      else if (path === "/assistant/photo")
        data = {
          items: [
            {
              label: "Paper packaging",
              category: "PAPER",
              certainty: "suggested",
            },
            {
              label: "Unclear container",
              category: null,
              certainty: "uncertain",
            },
          ],
          unresolvedItems: ["Container material unclear"],
          questions: ["What is the container made of?"],
          message: "Review every material.",
          confirmationToken: "mock-review-token",
        };
      else if (path === "/assistant/search") {
        searchMaterials = route.request().postDataJSON().materials;
        data = {
          outcome: "results",
          message: "Provisional collection options.",
          date: "2035-10-01",
          timezone: "Asia/Kolkata",
          addressId: address.id,
          materials: searchMaterials,
          providers: [provider],
        };
      } else if (path === "/providers/" + provider.id) data = provider;
      else {
        mutations++;
        await route.fulfill({
          status: 404,
          json: { error: { message: "Unexpected endpoint" } },
        });
        return;
      }
      await route.fulfill({ json: { data } });
    },
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/ask");
  await expect(
    page.getByRole("heading", { name: "Ask Loop", exact: true }),
  ).toBeFocused();
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel(/Waste photo \(optional/)
    .setInputFiles({ name: "paper.png", mimeType: "image/png", buffer: image });
  await expect(page.getByLabel(/Waste photo \(optional/)).toHaveValue(
    /paper\.png$/,
  );
  await page
    .getByRole("checkbox", { name: /I agree to send this photo/ })
    .check();
  await page.getByRole("button", { name: "Analyze photo" }).click();
  await expect(page.getByText("Container material unclear")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Find pickup options" }),
  ).toBeDisabled();
  await page.getByRole("checkbox", { name: "Plastic", exact: true }).check();
  await page
    .getByRole("checkbox", {
      name: "I reviewed and confirm the selected materials.",
    })
    .check();
  await page
    .getByRole("checkbox", { name: /I understand unresolved items/ })
    .check();
  await page.getByRole("button", { name: "Find pickup options" }).click();
  await expect(
    page.getByRole("link", { name: /^Review pickup:/ }),
  ).toBeVisible();
  expect(searchMaterials).toEqual(["PAPER", "PLASTIC"]);
  await page.screenshot({
    path: "test-results/ask-loop-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/ask-loop-mobile.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: /^Review pickup:/ }).click();
  await expect(page.getByLabel("Pickup address")).toHaveValue(address.id);
  await expect(
    page.getByRole("checkbox", { name: "Paper", exact: true }),
  ).toBeChecked();
  await expect(page.getByRole("radio")).toBeChecked();
  expect(mutations).toBe(0);
  expect(errors).toEqual([]);
});
