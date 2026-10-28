import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import ReactDOM from "react-dom/client";
import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
  Link,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./features/auth/AuthContext";
import { LoginPage } from "./features/auth/LoginPage";
import { ProtectedRoute } from "./routes/ProtectedRoute";
import { RouteScroll } from "./routes/RouteScroll";
import { AppLayout } from "./layouts/AppLayout";
import { ProvidersPage } from "./features/providers/ProvidersPage";
import { BookingPage } from "./features/bookings/BookingPage";
import { AddressesPage } from "./features/addresses/AddressesPage";
import { CheckoutPage } from "./features/payments/CheckoutPage";
import { OrdersPage } from "./features/orders/OrdersPage";
import { OrderDetailPage } from "./features/orders/OrderDetailPage";
import { Empty } from "./components/ui";
import "./styles.css";
import { AskLoopPage } from "./features/assistant/AskLoopPage";
const Router =
  import.meta.env.VITE_ROUTER_MODE === "hash" ? HashRouter : BrowserRouter;
const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    {(import.meta.env.VITE_DEMO_MODE === "true" ||
      import.meta.env.VITE_PUBLIC_DEMO_MODE === "true") && (
      <aside className="demo-notice" aria-label="Interactive demo">
        <span>
          <strong>Interactive demo.</strong>{" "}
          {import.meta.env.VITE_PUBLIC_DEMO_MODE === "true"
            ? "Sample bookings use the live API and database. No real pickups or payments. Please use fictional details."
            : "Sample data stays in this tab and resets on reload. No real pickups or payments. Please use fictional details."}
        </span>
        {import.meta.env.VITE_DEMO_MODE === "true" && (
          <button type="button" onClick={() => window.location.reload()}>
            Reset demo
          </button>
        )}
      </aside>
    )}
    <Router>
      <AuthProvider>
        <RouteScroll />
        <Routes>
          <Route path="/" element={<Navigate to="/providers" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/verify" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/ask" element={<AskLoopPage />} />
              <Route path="/providers" element={<ProvidersPage />} />
              <Route path="/providers/:id" element={<BookingPage />} />
              <Route path="/addresses" element={<AddressesPage />} />
              <Route path="/checkout/:id" element={<CheckoutPage />} />
              <Route path="/payment-result/:id" element={<OrderDetailPage />} />
              <Route path="/orders" element={<OrdersPage />} />
              <Route path="/orders/:id" element={<OrderDetailPage />} />
            </Route>
          </Route>
          <Route
            path="*"
            element={
              <Empty title="This path could use a little clearing.">
                <p>We couldn't find that page.</p>
                <Link className="button" to="/">
                  Back home
                </Link>
              </Empty>
            }
          />
        </Routes>
      </AuthProvider>
    </Router>
  </QueryClientProvider>,
);
