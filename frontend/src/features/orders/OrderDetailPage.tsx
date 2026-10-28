import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useLocation } from "react-router-dom";
import { Check, Clock, AlertCircle, ArrowRight, Leaf } from "lucide-react";
import { api } from "../../api/client";
import type { Booking } from "../../types";
import { BackLink, Loading, ErrorMessage, Status } from "../../components/ui";
import { money, dateLabel, timeLabel, wasteLabel } from "../../utils/format";
export function OrderDetailPage() {
  const { id } = useParams(),
    location = useLocation();
  const query = useQuery({
    queryKey: ["booking", id],
    queryFn: () => api<Booking>("/orders/" + id),
    refetchInterval: 10000,
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorMessage error={query.error} />;
  const b = query.data!;
  const success = ["PROCESSING", "COMPLETED"].includes(b.status),
    pending = ["PENDING_PAYMENT", "PAYMENT_PROCESSING"].includes(b.status),
    result = location.pathname.startsWith("/payment-result");
  return (
    <>
      <BackLink to="/orders" children="All pickups" />
      {result && (
        <div className="result-heading">
          <span className={"result-icon " + (success ? "" : "neutral")}>
            {success ? (
              <Check size={32} />
            ) : pending ? (
              <Clock size={32} />
            ) : (
              <AlertCircle size={32} />
            )}
          </span>
          <h1>
            {success
              ? "A little less waste is on its way."
              : pending
                ? "Your payment is still pending."
                : "Let's find another moment."}
          </h1>
          <p className="muted">
            {success
              ? import.meta.env.VITE_DEMO_MODE === "true"
                ? "Your simulated payment succeeded. This is a sample pickup."
                : "Your payment is verified. Your pickup is now processing."
              : b.payment?.status === "REFUND_REQUIRED"
                ? "Payment arrived after the slot was released. This pickup is not confirmed; a refund requires operator review."
                : "Your pickup is not confirmed. You can choose another available slot."}
          </p>
        </div>
      )}
      <div className="panel order-detail">
        <div className="order-detail-heading">
          <div>
            <span className="eyebrow">PICKUP DETAILS</span>
            <h2>{b.providerName}</h2>
          </div>
          <Status value={b.status} />
        </div>
        <div className="detail-grid">
          <div>
            <span className="detail-label">PICKUP DATE & TIME</span>
            <p>
              {dateLabel(b.startAt)}
              <br />
              {timeLabel(b.startAt)} · {timeLabel(b.endAt)} · India time
            </p>
          </div>
          <div>
            <span className="detail-label">COLLECTING</span>
            <p>{b.wasteTypes.map((w) => wasteLabel(w.wasteType)).join(", ")}</p>
          </div>
          <div>
            <span className="detail-label">PICKUP ADDRESS</span>
            <p>
              {b.addressSnapshot.label} · {b.addressSnapshot.contactName}
              <br />
              {b.addressSnapshot.addressLine1}
              <br />
              {b.addressSnapshot.addressLine2 && (
                <>
                  {b.addressSnapshot.addressLine2}
                  <br />
                </>
              )}
              {b.addressSnapshot.city}, {b.addressSnapshot.state}{" "}
              {b.addressSnapshot.postalCode}
              <br />
              {b.addressSnapshot.contactPhone}
            </p>
          </div>
          <div>
            <span className="detail-label">PAYMENT</span>
            <p className="detail-amount">{money(b.amount)}</p>
            <Status value={b.payment?.status ?? "UNPAID"} />
          </div>
        </div>
        <p className="booking-reference">Booking reference · {b.id}</p>
        {b.payment?.status === "REFUND_REQUIRED" && (
          <div className="error" role="alert">
            Payment needs refund review. This reservation did not take another
            user's slot. Contact the local application operator.
          </div>
        )}
        <div className="form-actions">
          {pending ? (
            <Link className="button" to={"/checkout/" + b.id}>
              Continue to payment
              <ArrowRight size={16} />
            </Link>
          ) : (
            <Link className="button" to="/providers">
              Book another pickup
              <ArrowRight size={16} />
            </Link>
          )}
          <Link className="button secondary" to="/orders">
            All pickups
          </Link>
        </div>
      </div>
      {success && (
        <div className="help-strip">
          <Leaf size={26} />
          <div>
            <h3>A little prep makes a big difference.</h3>
            <p>Sort your waste and keep it ready at your pickup address.</p>
          </div>
        </div>
      )}
    </>
  );
}
