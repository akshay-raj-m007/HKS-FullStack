import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useNavigate,
  useParams,
  useLocation,
  Link,
  Navigate,
} from "react-router-dom";
import {
  Clock,
  ShieldCheck,
  ArrowRight,
  MapPin,
  CalendarDays,
} from "lucide-react";
import { api, post } from "../../api/client";
import type { Booking, Payment } from "../../types";
import {
  Loading,
  ErrorMessage,
  BackLink,
  PageHeading,
} from "../../components/ui";
import { money, dateLabel, timeLabel, wasteLabel } from "../../utils/format";
import { openRazorpay } from "./razorpay";
import {
  appPath,
  collectionPath,
  invalidateAvailability,
  usePageActive,
  type NavigationState,
} from "../../routes/navigation";
export function CheckoutPage() {
  const { id } = useParams();
  return <Checkout key={id} id={id!} />;
}
function Checkout({ id }: { id: string }) {
  const navigate = useNavigate(),
    client = useQueryClient();
  const location = useLocation();
  const state = location.state as NavigationState | null;
  const collection = collectionPath(state);
  const active = usePageActive();
  const [modalController] = useState(() => new AbortController());
  const query = useQuery({
    queryKey: ["booking", id],
    queryFn: () => api<Booking>("/bookings/" + id),
    refetchInterval: 10000,
    refetchOnMount: "always",
  });
  const [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [payment, setPayment] = useState<Payment | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      modalController.abort();
    };
  }, [modalController]);
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorMessage error={query.error} />;
  const b = query.data!;
  if (!["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(b.status))
    return (
      <Navigate
        to={"/payment-result/" + id}
        replace
        state={{ collectionPath: collection }}
      />
    );
  const seconds = Math.max(
    0,
    Math.floor((new Date(b.holdExpiresAt).getTime() - now) / 1000),
  );
  const payable =
    seconds > 0 && ["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(b.status);
  const finish = async (booking: Booking) => {
    if (active.current) client.setQueryData(["booking", id], booking);
    await Promise.all([
      client.invalidateQueries({ queryKey: ["orders"] }),
      invalidateAvailability(client),
    ]);
    if (active.current)
      navigate("/payment-result/" + id, {
        replace: true,
        state: { collectionPath: collection },
      });
  };
  async function pay(outcome?: "success" | "failure") {
    setBusy(true);
    setError(null);
    try {
      const order =
        payment ?? (await post<Payment>("/payments/create", { bookingId: id }));
      if (!active.current) return;
      setPayment(order);
      if (order.provider === "mock") {
        if (outcome)
          await finish(
            await post<Booking>("/payments/mock", { bookingId: id, outcome }),
          );
      } else {
        const proof = await openRazorpay(order, modalController.signal);
        await finish(
          await post<Booking>("/payments/verify", { bookingId: id, ...proof }),
        );
      }
    } catch (e) {
      if (active.current) {
        setError(e);
        void query.refetch();
      }
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <>
      <BackLink
        to={
          appPath(state?.backTo).split(/[?#]/)[0] ===
          "/providers/" + b.providerId
            ? appPath(state?.backTo)
            : "/providers/" + b.providerId
        }
        children="Back to your partner"
      />
      <PageHeading
        eyebrow="ONE LAST THING"
        title="A fresh start, all booked in."
        description="Check your details and complete your sandbox payment."
      />
      <div className="two-column">
        <section className="panel">
          <h2>Your pickup summary</h2>
          <h3 className="checkout-provider">{b.providerName}</h3>
          <div className="tags">
            {b.wasteTypes.map((w) => (
              <span key={w.wasteType}>{wasteLabel(w.wasteType)}</span>
            ))}
          </div>
          <div className="checkout-detail">
            <MapPin />
            <div>
              <strong>
                {b.addressSnapshot.label} · {b.addressSnapshot.contactName}
              </strong>
              <p>
                {b.addressSnapshot.addressLine1}, {b.addressSnapshot.city}{" "}
                {b.addressSnapshot.postalCode}
              </p>
            </div>
          </div>
          <div className="checkout-detail">
            <CalendarDays />
            <div>
              <strong>{dateLabel(b.startAt)}</strong>
              <p>
                {timeLabel(b.startAt)} · {timeLabel(b.endAt)} · India time
              </p>
            </div>
          </div>
          <div className="price-total">
            <span>Pickup total</span>
            <strong>{money(b.amount)}</strong>
          </div>
          <p className="muted small">
            {import.meta.env.VITE_DEMO_MODE === "true"
              ? "Sample pricing for this interactive demo."
              : "The price is calculated and verified by the server."}
          </p>
        </section>
        <aside className="panel checkout-pay">
          <div className={"hold-timer " + (!payable ? "expired" : "")}>
            <Clock size={20} />
            {payable
              ? "Slot reserved for " +
                Math.floor(seconds / 60) +
                ":" +
                String(seconds % 60).padStart(2, "0")
              : "This reservation is no longer payable"}
          </div>
          <h2>Ready for a little less waste?</h2>
          <p className="muted">
            {import.meta.env.VITE_DEMO_MODE === "true"
              ? "Choose a simulated payment outcome to explore the booking flow."
              : "Your booking is confirmed only after the server verifies your payment."}
          </p>
          <ErrorMessage error={error} />
          {payable ? (
            <>
              {payment?.provider === "mock" ? (
                <div className="mock-payment">
                  <span className="pill subtle">LOCAL PAYMENT SANDBOX</span>
                  <p>No card details needed. Choose a test outcome.</p>
                  <button
                    className="button full"
                    disabled={busy}
                    onClick={() => void pay("success")}
                  >
                    {busy ? "Processing…" : "Simulate successful payment"}
                    <ArrowRight size={17} />
                  </button>
                  <button
                    className="button secondary full"
                    disabled={busy}
                    onClick={() => void pay("failure")}
                  >
                    Simulate failed payment
                  </button>
                </div>
              ) : (
                <button
                  className="button full"
                  disabled={busy}
                  onClick={() => void pay()}
                >
                  {busy ? "Opening payment…" : "Pay " + money(b.amount)}
                  <ArrowRight size={18} />
                </button>
              )}
              <button
                className="text-button cancel-link"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void post<Booking>("/bookings/" + id + "/cancel", {})
                    .then(finish)
                    .catch(setError)
                    .finally(() => setBusy(false));
                }}
              >
                Cancel reservation
              </button>
            </>
          ) : (
            <Link className="button full" to="/providers">
              Choose a new slot
            </Link>
          )}
          <p className="secure-caption">
            <ShieldCheck size={15} />
            Sandbox only. No real money is charged.
          </p>
        </aside>
      </div>
    </>
  );
}
