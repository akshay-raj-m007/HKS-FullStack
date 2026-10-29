import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, post } from "../api/client";
import { AskLoopPage } from "../features/assistant/AskLoopPage";
import { BookingPage } from "../features/bookings/BookingPage";
import type { Address, Provider } from "../types";
import type { SearchResult } from "../features/assistant/types";

vi.mock("../api/client", () => ({ api: vi.fn(), post: vi.fn() }));
const address: Address = {
  id: "33333333-3333-4333-8333-333333333333",
  label: "Home",
  city: "Bengaluru",
  postalCode: "560001",
  state: "Karnataka",
  contactName: "Resident",
  contactPhone: "+919876543210",
  addressLine1: "12 Garden Road",
  addressLine2: "",
};
const provider: Provider = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "GreenCycle Services",
  description: "Recycling",
  price: 14900,
  currency: "INR",
  color: "sage",
  rating: 4.8,
  wasteTypes: [{ wasteType: "PAPER" }, { wasteType: "PLASTIC" }],
  serviceAreas: [{ city: address.city, postalCode: address.postalCode }],
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
const capability = {
  enabled: true,
  chat: true,
  photo: true,
  reason: null,
  categories: ["PAPER", "PLASTIC"],
  imageMaxBytes: 2097152,
};
const results: SearchResult = {
  outcome: "results",
  message: "Live options, provisional until reserved.",
  date: "2035-10-01",
  timezone: "Asia/Kolkata",
  addressId: address.id,
  materials: ["PAPER", "PLASTIC"],
  providers: [provider],
};
const observation = {
  items: [
    { label: "Cardboard", category: "PAPER", certainty: "suggested" },
    { label: "Unclear container", category: null, certainty: "uncertain" },
  ],
  unresolvedItems: ["Container material unclear"],
  questions: ["What is the container made of?"],
  message: "Please review every material.",
  confirmationToken: "signed-photo-review",
};
function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  );
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/ask"]}>
        <Location />
        <Routes>
          <Route path="/ask" element={<AskLoopPage />} />
          <Route path="/providers" element={<p>Manual collection search</p>} />
          <Route path="/providers/:id" element={<BookingPage />} />
          <Route path="/checkout/:id" element={<p>Existing checkout</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(post).mockReset();
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/assistant/capabilities") return capability;
    if (path === "/addresses") return [address];
    if (path === "/assistant/photo") return observation;
    if (path === "/assistant/search") return results;
    if (path === "/providers/" + provider.id) return provider;
    throw new Error("Unexpected request: " + path);
  });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:loop-preview");
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
const submit = () =>
  screen.getByRole("button", { name: "Find pickup options" });

describe("Ask Loop review, grounded search and existing checkout", () => {
  it("rechecks the following day after empty availability using the new date", async () => {
    const fallback = vi.mocked(api).getMockImplementation()!;
    let searches = 0;
    vi.mocked(api).mockImplementation(async (path, options) =>
      path === "/assistant/search" && ++searches === 1
        ? {
            ...results,
            providers: [],
            outcome: "no_slots",
            message: "No live slots match that date.",
          }
        : fallback(path, options),
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("checkbox", { name: "Paper" }));
    await user.click(submit());
    await user.click(
      await screen.findByRole("button", { name: "Check the following day" }),
    );
    await screen.findByRole("link", { name: /^Review pickup:/ });
    const calls = vi
      .mocked(api)
      .mock.calls.filter(([path]) => path === "/assistant/search");
    expect(JSON.parse(calls[1][1]!.body as string).date).toBe("2035-10-02");
  });

  it("runs photo → editable suggestions → explicit confirmation → live cards → ordinary booking", async () => {
    const user = userEvent.setup();
    mount();
    const upload = await screen.findByLabelText(/Waste photo \(optional/);
    await user.upload(
      upload,
      new File(["image bytes"], "paper.png", { type: "image/png" }),
    );
    expect((upload as HTMLInputElement).files?.[0]?.name).toBe("paper.png");
    expect(
      screen.getByAltText("Selected waste photo for your review"),
    ).toHaveAttribute("src", "blob:loop-preview");
    expect(
      screen.getByRole("button", { name: "Analyze photo" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", { name: /I agree to send this photo/ }),
    );
    await user.click(screen.getByRole("button", { name: "Analyze photo" }));
    expect(
      await screen.findByText("Container material unclear"),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Paper" })).toBeChecked();
    expect(submit()).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Plastic" }));
    await user.click(
      screen.getByRole("checkbox", {
        name: "I reviewed and confirm the selected materials.",
      }),
    );
    expect(submit()).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", { name: /I understand unresolved items/ }),
    );
    await user.selectOptions(
      screen.getByLabelText("Saved pickup address (optional)"),
      address.id,
    );
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));
    await user.click(submit());
    const card = await screen.findByRole("link", { name: /^Review pickup:/ });
    const searchCall = vi
      .mocked(api)
      .mock.calls.find(([path]) => path === "/assistant/search")!;
    expect(JSON.parse(searchCall[1]!.body as string)).toMatchObject({
      materials: ["PAPER", "PLASTIC"],
      addressId: address.id,
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      message: "Find pickup options for my selected materials.",
      photoConfirmation: {
        token: "signed-photo-review",
        confirmed: true,
        acknowledgeUnresolved: true,
      },
    });
    expect(card).toHaveAttribute(
      "href",
      expect.stringContaining("slotId=" + provider.slots[0].id),
    );
    await user.click(card);
    expect(await screen.findByLabelText("Pickup address")).toHaveValue(
      address.id,
    );
    expect(screen.getByRole("checkbox", { name: "Paper" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Plastic" })).toBeChecked();
    await waitFor(() => expect(screen.getByRole("radio")).toBeChecked());
    expect(post).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:loop-preview");
  });
  it("keeps unavailable slots out of an assistant draft on entering the existing booking page", async () => {
    const fallback = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path, options) =>
      path === "/providers/" + provider.id
        ? { ...provider, slots: [] }
        : fallback(path, options),
    );
    const user = userEvent.setup();
    mount();
    await user.type(
      await screen.findByLabelText("What needs collecting?"),
      "Paper at Home tomorrow",
    );
    await user.click(submit());
    await user.click(
      await screen.findByRole("link", { name: /^Review pickup:/ }),
    );
    expect(await screen.findByLabelText("Pickup address")).toHaveValue(
      address.id,
    );
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
  it("uses a clarification as conversation context and clears stale cards when inputs change", async () => {
    const user = userEvent.setup();
    mount();
    await user.type(
      await screen.findByLabelText("What needs collecting?"),
      "Paper please",
    );
    const fallback = vi.mocked(api).getMockImplementation()!;
    let calls = 0;
    vi.mocked(api).mockImplementation(async (path, options) =>
      path === "/assistant/search" && ++calls === 1
        ? {
            ...results,
            providers: [],
            outcome: "clarification",
            message: "Which date?",
          }
        : fallback(path, options),
    );
    await user.click(submit());
    expect(
      await screen.findByText("Which date?", { selector: "p" }),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText("What needs collecting?"));
    await user.type(
      screen.getByLabelText("What needs collecting?"),
      "Tomorrow",
    );
    await user.click(submit());
    await screen.findByRole("link", { name: /^Review pickup:/ });
    const requests = vi
      .mocked(api)
      .mock.calls.filter(([path]) => path === "/assistant/search");
    expect(JSON.parse(requests[1][1]!.body as string).history).toEqual([
      { role: "user", text: "Paper please" },
      { role: "assistant", text: "Which date?" },
    ]);
    await user.type(
      screen.getByLabelText(
        "City or postal code (when no saved address is chosen)",
      ),
      "Mumbai",
    );
    expect(
      screen.queryByRole("link", { name: /^Review pickup:/ }),
    ).not.toBeInTheDocument();
  });
  it.each(["disabled", "old-backend"])(
    "keeps manual discovery usable with %s AI",
    async (mode) => {
      vi.mocked(api).mockImplementation(async () => {
        if (mode === "old-backend") throw new Error("Not found");
        return { ...capability, enabled: false, chat: false, photo: false };
      });
      const user = userEvent.setup();
      mount();
      expect(
        await screen.findByText("Ask Loop is currently unavailable."),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText("What needs collecting?"),
      ).not.toBeInTheDocument();
      await user.click(
        screen.getByRole("link", { name: "Use manual collection search" }),
      );
      expect(screen.getByText("Manual collection search")).toBeInTheDocument();
    },
  );
  it("announces an error, retries within the same page, and prevents duplicate submits", async () => {
    const fallback = vi.mocked(api).getMockImplementation()!;
    let first = true;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === "/assistant/search" && first) {
        first = false;
        throw new Error("AI service unavailable; use manual search.");
      }
      return fallback(path, options);
    });
    const user = userEvent.setup();
    mount();
    await user.type(
      await screen.findByLabelText("What needs collecting?"),
      "Paper at Home tomorrow",
    );
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "AI service unavailable",
    );
    await user.click(
      screen.getByRole("button", { name: "Retry last request" }),
    );
    await screen.findByRole("link", { name: /^Review pickup:/ });
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(([path]) => path === "/assistant/search"),
    ).toHaveLength(2);
  });
  it("cancels in-flight work and ignores a superseded response even if transport ignores abort", async () => {
    const fallback = vi.mocked(api).getMockImplementation()!;
    let finish!: (value: SearchResult) => void;
    let signal: AbortSignal | undefined;
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === "/assistant/search") {
        signal = options?.signal as AbortSignal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return fallback(path, options);
    });
    const user = userEvent.setup();
    mount();
    await user.type(
      await screen.findByLabelText("What needs collecting?"),
      "Paper tomorrow",
    );
    await user.click(submit());
    expect(submit()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel analysis" }));
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(results));
    expect(
      screen.queryByRole("link", { name: /^Review pickup:/ }),
    ).not.toBeInTheDocument();
    expect(submit()).toBeEnabled();
  });
  it("aborts requests on navigation and never navigates from a late model response", async () => {
    const fallback = vi.mocked(api).getMockImplementation()!;
    let signal: AbortSignal | undefined;
    let finish!: (value: SearchResult) => void;
    vi.mocked(api).mockImplementation(async (path, options) =>
      path === "/assistant/search"
        ? new Promise((resolve) => {
            signal = options?.signal as AbortSignal;
            finish = resolve;
          })
        : fallback(path, options),
    );
    const user = userEvent.setup();
    mount();
    await user.type(
      await screen.findByLabelText("What needs collecting?"),
      "Paper tomorrow",
    );
    await user.click(submit());
    await user.click(
      screen.getByRole("link", { name: "Use manual collection search" }),
    );
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(results));
    expect(screen.getByText("Manual collection search")).toBeInTheDocument();
  });
  it("removes photo state and preview, and rejects an oversized image before upload", async () => {
    const user = userEvent.setup();
    mount();
    const input = await screen.findByLabelText(/Waste photo \(optional/);
    await user.upload(
      input,
      new File(["image"], "paper.png", { type: "image/png" }),
    );
    await user.click(screen.getByRole("button", { name: "Remove photo" }));
    expect(
      screen.queryByAltText("Selected waste photo for your review"),
    ).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    await user.upload(
      input,
      new File([new Uint8Array(2097153)], "huge.png", { type: "image/png" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no larger than 2 MiB",
    );
    expect(
      vi.mocked(api).mock.calls.filter(([path]) => path === "/assistant/photo"),
    ).toHaveLength(0);
  });
});
