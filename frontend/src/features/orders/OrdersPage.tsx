import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { ArrowUpRight, CalendarDays, MapPin, Package } from "lucide-react";
import { api } from "../../api/client";
import type { Booking } from "../../types";
import {
  PageHeading,
  Loading,
  ErrorMessage,
  Empty,
  Status,
} from "../../components/ui";
import { money, dateLabel, timeLabel, wasteLabel } from "../../utils/format";
export function OrdersPage() {
  const location = useLocation();
  const query = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<Booking[]>("/orders"),
    refetchInterval: 15000,
  });
  return (
    <>
      <PageHeading
        eyebrow="YOUR LITTLE ACTS OF GOOD"
        title="Pickups, all in one place."
        description="Every collection is a step toward a cleaner neighbourhood."
      >
        <Link className="button" to="/providers">
          Book a pickup
          <ArrowUpRight size={17} />
        </Link>
      </PageHeading>
      <ErrorMessage error={query.error} />
      {query.isPending ? (
        <Loading />
      ) : query.data?.length ? (
        <div className="orders-list">
          {query.data.map((b) => (
            <article className="panel order-card" key={b.id}>
              <span className="order-icon">
                <Package size={25} />
              </span>
              <div className="order-main">
                <div className="order-title">
                  <h2>{b.providerName}</h2>
                  <Status value={b.status} />
                </div>
                <p className="muted">
                  {b.wasteTypes.map((w) => wasteLabel(w.wasteType)).join(" · ")}
                </p>
                <div className="order-meta">
                  <span>
                    <CalendarDays size={15} />
                    {dateLabel(b.startAt)} · {timeLabel(b.startAt)} –{" "}
                    {timeLabel(b.endAt)}
                  </span>
                  <span>
                    <MapPin size={15} />
                    {b.addressSnapshot.label} · {b.addressSnapshot.addressLine1}
                    , {b.addressSnapshot.city} {b.addressSnapshot.postalCode}
                  </span>
                </div>
              </div>
              <div className="order-end">
                <strong>{money(b.amount)}</strong>
                <span className="small">
                  Payment: <Status value={b.payment?.status ?? "UNPAID"} />
                </span>
                <Link
                  className="text-link"
                  to={"/orders/" + b.id}
                  state={{ backTo: location.pathname + location.search }}
                >
                  View details
                  <ArrowUpRight size={15} />
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        !query.error && (
          <Empty title="Your first pickup is a small step away.">
            <p>Find a partner, choose a time, and we'll take it from there.</p>
            <Link className="button" to="/providers">
              Explore collection partners
            </Link>
          </Empty>
        )
      )}
    </>
  );
}
