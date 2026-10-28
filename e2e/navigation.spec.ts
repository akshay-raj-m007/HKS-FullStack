import { test, expect, type Page } from "@playwright/test";
import type { Address, Booking, Provider } from "../frontend/src/types";

const address: Address = {
  id: "33333333-3333-4333-8333-333333333333",
  label: "Home",
  contactName: "Test Resident",
  contactPhone: "+919876543210",
  addressLine1: "GardenRoad".repeat(17),
  addressLine2: "",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560001",
};
const provider: Provider = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "GreenCycle Services",
  description: "Thoughtful local recycling",
  price: 14900,
  currency: "INR",
  rating: 4.8,
  color: "sage",
  wasteTypes: [{ wasteType: "PLASTIC" }],
  serviceAreas: [{ city: "Bengaluru", postalCode: "560001" }],
  slots: [9, 13].map((hour, i) => ({
    id: `22222222-2222-4222-8222-22222222222${i}`,
    providerId: "11111111-1111-4111-8111-111111111111",
    startAt: `2035-10-01T${String(hour).padStart(2, "0")}:00:00+05:30`,
    endAt: `2035-10-01T${String(hour + 1).padStart(2, "0")}:00:00+05:30`,
    status: "AVAILABLE",
  })),
};
function booking(id: string): Booking {
  return {
    id,
    providerId: provider.id,
    slotId: provider.slots[0].id,
    providerName: provider.name,
    addressSnapshot: address,
    wasteTypes: [{ wasteType: "PLASTIC" }],
    startAt: provider.slots[0].startAt,
    endAt: provider.slots[0].endAt,
    amount: 14900,
    currency: "INR",
    status: "PENDING_PAYMENT",
    holdExpiresAt: new Date(Date.now() + 600000).toISOString(),
    createdAt: new Date().toISOString(),
    payment: null,
  };
}

// Browser-only regressions use deterministic API responses; acceptance.spec.ts exercises the real API.
async function mockApp(page: Page, signedIn = true, gateway = "mock") {
  let held = false;
  let challenge = 0;
  const bookings = new Map([["booking-a", booking("booking-a")]]);
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(/^\/api/, "");
      const body = request.method() === "POST" ? request.postDataJSON() : null;
      const session = {
        accessToken: "ui-test-session",
        user: { id: "user-a", phone: "+919876543210" },
      };
      let data: unknown;
      if (path === "/auth/refresh") {
        if (!signedIn)
          return route.fulfill({
            status: 401,
            json: {
              error: { code: "INVALID_SESSION", message: "Please sign in." },
            },
          });
        data = session;
      } else if (path === "/auth/request-otp") {
        data = { challengeId: "challenge-" + ++challenge, resendAfter: 0 };
      } else if (path === "/auth/verify-otp") {
        signedIn = true;
        data = session;
      } else if (path === "/addresses") data = [address];
      else if (path === "/providers")
        data = [
          {
            ...provider,
            slots: held ? provider.slots.slice(1) : provider.slots,
          },
        ];
      else if (path === "/providers/" + provider.id)
        data = {
          ...provider,
          slots: held ? provider.slots.slice(1) : provider.slots,
        };
      else if (path === "/bookings/hold") {
        held = true;
        data = booking("booking-held");
        bookings.set("booking-held", data as Booking);
      } else if (/^\/bookings\/[^/]+\/cancel$/.test(path)) {
        const current = bookings.get(path.split("/")[2])!;
        current.status = "CANCELLED";
        held = false;
        data = current;
      } else if (/^\/(bookings|orders)\/[^/]+$/.test(path)) {
        data = bookings.get(path.split("/")[2]) ?? {
          ...booking("paid-booking"),
          status: "PROCESSING",
          payment: { status: "PAID" },
        };
      } else if (path === "/orders")
        data = [
          {
            ...booking("paid-booking"),
            status: "PROCESSING",
            payment: { status: "PAID" },
          },
        ];
      else if (path === "/payments/create")
        data = {
          id: "payment-a",
          provider: gateway,
          providerOrderId: "order-a",
          status: "CREATED",
          amount: 14900,
          currency: "INR",
          keyId: "rzp_test_public",
        };
      else if (path === "/payments/mock") {
        const current = bookings.get(body.bookingId)!;
        current.status =
          body.outcome === "success" ? "PROCESSING" : "PAYMENT_FAILED";
        current.payment = {
          id: "payment-a",
          provider: "mock",
          providerOrderId: "order-a",
          status: body.outcome === "success" ? "PAID" : "FAILED",
          amount: 14900,
          currency: "INR",
        };
        data = current;
      } else throw new Error("Unmocked UI test endpoint: " + path);
      await route.fulfill({ json: { data } });
    },
  );
}
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
});
test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test("browser and app Back restore collection filters, scroll and forward history", async ({
  page,
}) => {
  await mockApp(page);
  await page.goto("/providers");
  await page.getByRole("button", { name: "Plastic", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Location", exact: true })
    .selectOption("Bengaluru");
  await page.getByLabel("Time of day").selectOption("morning");
  const link = page.getByRole("link", { name: "View slots" });
  await link.scrollIntoViewIfNeeded();
  const oldScroll = await page.evaluate(() => window.scrollY);
  await link.click();
  await expect(page.getByLabel("Pickup address")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole("link", { name: "Back to collection" }).click();
  await expect(
    page.getByRole("button", { name: "Plastic", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("combobox", { name: "Location", exact: true }),
  ).toHaveValue("Bengaluru");
  await expect(page.getByLabel("Time of day")).toHaveValue("morning");
  await expect
    .poll(async () =>
      Math.abs((await page.evaluate(() => window.scrollY)) - oldScroll),
    )
    .toBeLessThan(5);
  await page.goForward();
  await expect(page.getByLabel("Pickup address")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/wasteType=PLASTIC/);
});

test("address detours preserve drafts and Back sees fresh slots after hold and cancellation", async ({
  page,
}) => {
  await mockApp(page);
  await page.goto("/providers");
  await page.getByRole("link", { name: "View slots" }).click();
  await page.getByLabel("Pickup address").selectOption(address.id);
  await page.getByRole("checkbox", { name: "Plastic", exact: true }).check();
  await page.getByRole("radio").first().check();
  await page.getByRole("link", { name: "Add or manage addresses" }).click();
  await page.getByRole("link", { name: "Back to your pickup" }).click();
  await expect(page.getByLabel("Pickup address")).toHaveValue(address.id);
  await expect(
    page.getByRole("checkbox", { name: "Plastic", exact: true }),
  ).toBeChecked();
  await expect(page.getByRole("radio").first()).toBeChecked();
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page).toHaveURL(/\/checkout\/booking-held/);
  await page.goBack();
  await expect(page.getByRole("radio")).toHaveCount(1);
  await expect(page.getByRole("radio")).not.toBeChecked();
  await page.goForward();
  await page.getByRole("button", { name: "Cancel reservation" }).click();
  await expect(page).toHaveURL(/\/payment-result\/booking-held/);
  await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp("/providers/" + provider.id));
  await expect(page.getByRole("radio")).toHaveCount(2);
});

test("OTP resends replace history and missing challenges recover to login", async ({
  page,
}) => {
  await mockApp(page, false);
  await page.goto("/verify");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("Mobile number").fill("+919876543210");
  await page.getByRole("button", { name: "Get verification code" }).click();
  await expect(page.getByLabel("Verification code")).toBeVisible();
  await page.getByRole("button", { name: "Resend code", exact: true }).click();
  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
  await page.goForward();
  await expect(page.getByLabel("Verification code")).toBeVisible();
  await page.getByRole("link", { name: "Change number" }).click();
  await expect(page.getByLabel("Mobile number")).toHaveValue("+919876543210");
});

test("protected deep links survive OTP login", async ({ page }) => {
  await mockApp(page, false);
  await page.goto("/orders/booking-a");
  await page.getByLabel("Mobile number").fill("+919876543210");
  await page.getByRole("button", { name: "Get verification code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify & continue" }).click();
  await expect(page).toHaveURL(/\/orders\/booking-a$/);
  await expect(
    page.getByText("Booking reference", { exact: false }),
  ).toBeVisible();
});

test("leaving checkout closes a gateway modal", async ({ page }) => {
  await mockApp(page, true, "razorpay");
  await page.addInitScript(() => {
    Object.assign(window, {
      Razorpay: class {
        private modal = document.createElement("div");
        open() {
          this.modal.dataset.testid = "gateway-modal";
          document.body.appendChild(this.modal);
        }
        close() {
          this.modal.remove();
        }
        on() {}
      },
    });
  });
  await page.goto("/providers");
  await page.getByRole("link", { name: "Addresses", exact: true }).click();
  await page.goto("/checkout/booking-a");
  await page.getByRole("button", { name: /^Pay / }).click();
  await expect(page.getByTestId("gateway-modal")).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/addresses$/);
  await expect(page.getByTestId("gateway-modal")).toHaveCount(0);
});

test("long address content and native controls fit mobile and tablet layouts", async ({
  page,
}) => {
  await mockApp(page);
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of [
      "/providers/" + provider.id,
      "/addresses",
      "/orders",
      "/orders/paid-booking",
    ]) {
      await page.goto(path);
      await expect(page.locator("main .panel").first()).toBeVisible();
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      const overflowing = await page
        .locator("main .panel, main input, main select, .header nav")
        .evaluateAll((elements) =>
          elements
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.left < -1 || r.right > window.innerWidth + 1;
            })
            .map((el) => el.className || el.tagName),
        );
      expect(overflowing, `${path} at ${width}px`).toEqual([]);
    }
    if (width === 320 || width === 768)
      await page.screenshot({
        path: `test-results/navigation-${width}.png`,
        fullPage: true,
      });
  }
});
