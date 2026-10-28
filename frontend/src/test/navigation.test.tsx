import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComponentProps } from "react";
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, post } from "../api/client";
import { BackLink } from "../components/ui";
import { LoginPage } from "../features/auth/LoginPage";
import { ProvidersPage } from "../features/providers/ProvidersPage";
import { BookingPage } from "../features/bookings/BookingPage";
import { CheckoutPage } from "../features/payments/CheckoutPage";
import { ProtectedRoute } from "../routes/ProtectedRoute";
import { AddressesPage } from "../features/addresses/AddressesPage";
import { AppLayout } from "../layouts/AppLayout";
import type { Address, Booking, Provider } from "../types";

vi.mock("../api/client", () => ({ api: vi.fn(), post: vi.fn() }));
const auth = vi.hoisted(() => ({
  user: null as { id: string; phone: string } | null,
  loading: false,
  signIn: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("../features/auth/AuthContext", () => ({ useAuth: () => auth }));

const address: Address = {
  id: "33333333-3333-4333-8333-333333333333",
  label: "Home",
  contactName: "Test Resident",
  contactPhone: "+919876543210",
  addressLine1: "12 Garden Road",
  addressLine2: "",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560001",
};
const provider: Provider = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "GreenCycle Services",
  description: "Local recycling",
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
      startAt: "2035-10-01T03:30:00Z",
      endAt: "2035-10-01T04:30:00Z",
      status: "AVAILABLE",
    },
  ],
};
const booking = (id = "booking-a"): Booking => ({
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
});
function HistoryControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={() => navigate(-1)}>History back</button>
      <button onClick={() => navigate(1)}>History forward</button>
      <span data-testid="location">{location.pathname + location.search}</span>
    </>
  );
}
function mount(
  routes: React.ReactNode,
  initialEntries: ComponentProps<typeof MemoryRouter>["initialEntries"],
  initialIndex?: number,
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 15000 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
        <HistoryControls />
        <Routes>{routes}</Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.resetAllMocks();
  auth.user = null;
  auth.loading = false;
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/addresses"
      ? [address]
      : path.startsWith("/bookings/")
        ? booking(path.split("/").at(-1))
        : path.startsWith("/providers/")
          ? provider
          : [provider],
  );
});

describe("navigation regressions", () => {
  it("clears a previous address deletion error when opening another editor", async () => {
    const user = userEvent.setup();
    vi.mocked(api).mockImplementation(async (_path, options) => {
      if (options?.method === "DELETE")
        throw new Error("This address is used by a booking.");
      return [address];
    });
    mount(<Route path="/addresses" element={<AddressesPage />} />, [
      "/addresses",
    ]);
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Yes, remove" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This address is used by a booking.",
    );
    await user.click(screen.getByRole("button", { name: "Add address" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Yes, remove" }),
    ).not.toBeInTheDocument();
  });

  it("clears header errors across route changes and browser Back", async () => {
    const user = userEvent.setup();
    auth.logout.mockRejectedValue(new Error("Could not sign out."));
    mount(
      <Route element={<AppLayout />}>
        <Route path="/providers" element={<p>Collection page</p>} />
        <Route path="/addresses" element={<p>Address page</p>} />
      </Route>,
      ["/providers"],
    );
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not sign out.",
    );
    await user.click(screen.getByRole("link", { name: "Addresses" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "History back" }));
    expect(screen.getByText("Collection page")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("restores provider filters on browser Back and app Back without a history loop", async () => {
    const user = userEvent.setup();
    mount(
      <>
        <Route path="/providers" element={<ProvidersPage />} />
        <Route path="/providers/:id" element={<BookingPage />} />
      </>,
      ["/providers"],
    );
    await user.click(screen.getByRole("button", { name: "Plastic" }));
    await user.click(await screen.findByRole("link", { name: "View slots" }));
    await user.click(
      await screen.findByRole("link", { name: "Back to collection" }),
    );
    expect(screen.getByRole("button", { name: "Plastic" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "wasteType=PLASTIC",
    );
    await user.click(screen.getByRole("button", { name: "History forward" }));
    expect(await screen.findByLabelText("Pickup address")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "History back" }));
    expect(screen.getByRole("button", { name: "Plastic" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("uses the OTP challenge belonging to the current history entry", async () => {
    const user = userEvent.setup();
    const challenge = (phone: string) => ({
      challengeId: phone,
      phone,
      resendAt: Date.now() + 60000,
    });
    mount(
      <Route path="/verify" element={<LoginPage />} />,
      [
        {
          pathname: "/verify",
          state: { challenge: challenge("+919876543210") },
        },
        {
          pathname: "/verify",
          state: { challenge: challenge("+919876543211") },
        },
      ],
      0,
    );
    expect(screen.getByText(/Enter the six-digit code for/)).toHaveTextContent(
      "+919876543210",
    );
    await user.click(screen.getByRole("button", { name: "History forward" }));
    expect(screen.getByText(/Enter the six-digit code for/)).toHaveTextContent(
      "+919876543211",
    );
  });

  it("redirects an OTP URL without a challenge to login", async () => {
    mount(
      <>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verify" element={<LoginPage />} />
      </>,
      ["/verify"],
    );
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/login"),
    );
  });

  it("waits for session restoration before showing the login form", () => {
    auth.loading = true;
    mount(<Route path="/login" element={<LoginPage />} />, ["/login"]);
    expect(screen.queryByLabelText("Mobile number")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Restoring your session",
    );
  });

  it("retains the requested protected URL through sign-in", async () => {
    const user = userEvent.setup();
    vi.mocked(post)
      .mockResolvedValueOnce({ challengeId: "challenge", resendAfter: 60 })
      .mockResolvedValueOnce({
        user: { id: "a", phone: "+919876543210" },
        accessToken: "token",
      });
    mount(
      <>
        <Route element={<ProtectedRoute />}>
          <Route path="/orders/:id" element={<p>Requested pickup</p>} />
        </Route>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/verify" element={<LoginPage />} />
        <Route path="/providers" element={<p>Collection</p>} />
      </>,
      ["/orders/booking-a"],
    );
    await user.clear(await screen.findByLabelText("Mobile number"));
    await user.type(screen.getByLabelText("Mobile number"), "+919876543210");
    await user.click(
      screen.getByRole("button", { name: "Get verification code" }),
    );
    await user.type(
      await screen.findByLabelText("Verification code"),
      "123456",
    );
    auth.signIn.mockImplementation(() => {
      auth.user = { id: "a", phone: "+919876543210" };
    });
    await user.click(screen.getByRole("button", { name: "Verify & continue" }));
    expect(await screen.findByText("Requested pickup")).toBeInTheDocument();
  });

  it("preserves a booking draft while visiting addresses and returning", async () => {
    const user = userEvent.setup();
    mount(
      <>
        <Route path="/providers/:id" element={<BookingPage />} />
        <Route path="/addresses" element={<p>Manage addresses</p>} />
      </>,
      ["/providers/" + provider.id],
    );
    await user.selectOptions(
      await screen.findByLabelText("Pickup address"),
      address.id,
    );
    await user.click(screen.getByRole("checkbox", { name: "Plastic" }));
    await user.click(screen.getByRole("radio"));
    await user.click(
      screen.getByRole("link", { name: "Add or manage addresses" }),
    );
    await user.click(screen.getByRole("button", { name: "History back" }));
    expect(await screen.findByLabelText("Pickup address")).toHaveValue(
      address.id,
    );
    expect(screen.getByRole("checkbox", { name: "Plastic" })).toBeChecked();
    expect(screen.getByRole("radio")).toBeChecked();
  });

  it("does not reuse an opened payment sandbox for another booking URL", async () => {
    const user = userEvent.setup();
    vi.mocked(post).mockResolvedValue({ id: "payment-a", provider: "mock" });
    mount(
      <Route
        path="/checkout/:id"
        element={
          <>
            <Link to="/checkout/booking-b">Other checkout</Link>
            <CheckoutPage />
          </>
        }
      />,
      ["/checkout/booking-a"],
    );
    await user.click(await screen.findByRole("button", { name: /^Pay / }));
    expect(
      await screen.findByRole("button", {
        name: "Simulate successful payment",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Other checkout" }));
    expect(
      await screen.findByRole("button", { name: /^Pay / }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Simulate successful payment" }),
    ).not.toBeInTheDocument();
  });

  it("does not redirect back to checkout when a hold completes after leaving the booking page", async () => {
    const user = userEvent.setup();
    let finish!: (value: Booking) => void;
    vi.mocked(post).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mount(
      <>
        <Route path="/providers/:id" element={<BookingPage />} />
        <Route path="/addresses" element={<p>Manage addresses</p>} />
        <Route path="/checkout/:id" element={<p>Unexpected checkout</p>} />
      </>,
      ["/providers/" + provider.id],
    );
    await user.selectOptions(
      await screen.findByLabelText("Pickup address"),
      address.id,
    );
    await user.click(screen.getByRole("checkbox", { name: "Plastic" }));
    await user.click(screen.getByRole("radio"));
    await user.click(
      screen.getByRole("button", { name: "Continue to payment" }),
    );
    await waitFor(() => expect(post).toHaveBeenCalled());
    await user.click(
      screen.getByRole("link", { name: "Add or manage addresses" }),
    );
    await act(async () => finish(booking()));
    expect(screen.getByText("Manage addresses")).toBeInTheDocument();
    expect(screen.queryByText("Unexpected checkout")).not.toBeInTheDocument();
  });

  it("uses a safe app Back destination when opened directly", async () => {
    const user = userEvent.setup();
    mount(
      <>
        <Route path="/direct" element={<BackLink />} />
        <Route path="/providers" element={<p>Collection</p>} />
      </>,
      ["/direct"],
    );
    await user.click(screen.getByRole("link", { name: "Back to collection" }));
    expect(screen.getByText("Collection")).toBeInTheDocument();
  });
});
