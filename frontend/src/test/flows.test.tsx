import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, post } from "../api/client";
import { LoginPage } from "../features/auth/LoginPage";
import { ProvidersPage } from "../features/providers/ProvidersPage";
import { BookingPage } from "../features/bookings/BookingPage";
import { OrdersPage } from "../features/orders/OrdersPage";
import { Provider } from "../types";
vi.mock("../api/client", () => ({ api: vi.fn(), post: vi.fn() }));
const signIn = vi.fn();
vi.mock("../features/auth/AuthContext", () => ({
  useAuth: () => ({ user: null, signIn, loading: false }),
}));
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
  slots: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      providerId: "11111111-1111-4111-8111-111111111111",
      startAt: "2030-10-01T03:30:00Z",
      endAt: "2030-10-01T04:30:00Z",
      status: "AVAILABLE",
    },
  ],
};
function wrapper(element: React.ReactNode, path = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
});
describe("important user flows", () => {
  it("requests a phone OTP, verifies the code, and signs in", async () => {
    const user = userEvent.setup();
    vi.mocked(post)
      .mockResolvedValueOnce({ challengeId: "challenge", resendAfter: 60 })
      .mockResolvedValueOnce({
        accessToken: "token",
        user: { id: "user", phone: "+919876543210" },
      });
    wrapper(
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verify" element={<LoginPage />} />
        <Route path="/providers" element={<p>Welcome to collection</p>} />
      </Routes>,
      "/login",
    );
    await user.clear(screen.getByLabelText("Mobile number"));
    await user.type(screen.getByLabelText("Mobile number"), "+919876543210");
    await user.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    await user.type(
      await screen.findByLabelText("Verification code"),
      "849215",
    );
    await user.click(screen.getByRole("button", { name: "Verify & continue" }));
    expect(
      await screen.findByText("Welcome to collection"),
    ).toBeInTheDocument();
    expect(signIn).toHaveBeenCalledWith({
      accessToken: "token",
      user: { id: "user", phone: "+919876543210" },
    });
  });
  it("shows phone validation without sending an invalid request", async () => {
    const user = userEvent.setup();
    wrapper(<LoginPage />, "/login");
    await user.clear(screen.getByLabelText("Mobile number"));
    await user.type(screen.getByLabelText("Mobile number"), "12");
    await user.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    expect(await screen.findByText(/Enter a valid mobile/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
  it("rejects a valid landline number in the mobile login form", async () => {
    const user = userEvent.setup();
    wrapper(<LoginPage />, "/login");
    await user.clear(screen.getByLabelText("Mobile number"));
    await user.type(screen.getByLabelText("Mobile number"), "+918023456789");
    await user.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    expect(await screen.findByText(/Enter a valid mobile/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
  it("renders providers and updates the waste filter", async () => {
    const user = userEvent.setup();
    vi.mocked(api).mockImplementation(async (path) =>
      path === "/addresses" ? [] : [provider],
    );
    wrapper(<ProvidersPage />);
    expect(
      await screen.findByRole("heading", { name: "GreenCycle Services" }),
    ).toBeInTheDocument();
    expect(screen.getByText("₹149")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Plastic" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/providers?wasteType=PLASTIC"),
    );
  });
  it("shows a useful provider empty state", async () => {
    vi.mocked(api).mockResolvedValue([]);
    wrapper(<ProvidersPage />);
    expect(
      await screen.findByText("No partners for these filters"),
    ).toBeInTheDocument();
  });
  it("validates address, waste type, and slot before holding a booking", async () => {
    const user = userEvent.setup();
    vi.mocked(api).mockImplementation(async (path) =>
      path === "/addresses" ? [] : provider,
    );
    wrapper(
      <Routes>
        <Route path="/providers/:id" element={<BookingPage />} />
      </Routes>,
      "/providers/" + provider.id,
    );
    await user.click(
      await screen.findByRole("button", { name: "Continue to payment" }),
    );
    expect(
      await screen.findByText("Select a pickup address."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Select at least one waste type."),
    ).toBeInTheDocument();
    expect(screen.getByText("Select a time slot.")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
  it("renders confirmed orders with payment and processing state", async () => {
    vi.mocked(api).mockResolvedValue([
      {
        id: "booking",
        providerName: "GreenCycle Services",
        wasteTypes: [{ wasteType: "PLASTIC" }],
        addressSnapshot: {
          label: "Home",
          addressLine1: "12 Garden Road",
          city: "Bengaluru",
          postalCode: "560001",
        },
        startAt: provider.slots[0].startAt,
        endAt: provider.slots[0].endAt,
        amount: 14900,
        status: "PROCESSING",
        payment: { status: "PAID" },
      },
    ]);
    wrapper(<OrdersPage />);
    expect(await screen.findByText("PROCESSING")).toBeInTheDocument();
    expect(screen.getByText("PAID")).toBeInTheDocument();
    expect(screen.getByText(/12 Garden Road/)).toBeInTheDocument();
  });
  it("shows API errors accessibly", async () => {
    vi.mocked(api).mockRejectedValue(new Error("Could not load your pickups."));
    wrapper(<OrdersPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load your pickups.",
    );
  });
});
