import { useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Link,
  useParams,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import {
  MapPin,
  CalendarDays,
  Clock,
  ShieldCheck,
  ArrowRight,
  Leaf,
} from "lucide-react";
import { api, post } from "../../api/client";
import type { Provider, Address, Booking } from "../../types";
import { wasteTypes } from "../../types";
import {
  collectionPath,
  invalidateAvailability,
  usePageActive,
  type NavigationState,
} from "../../routes/navigation";
import { bookingSchema } from "../../schemas/forms";
import { BackLink, Loading, ErrorMessage } from "../../components/ui";
import {
  money,
  dateLabel,
  timeLabel,
  localDay,
  wasteLabel,
} from "../../utils/format";
export function BookingPage() {
  const { id } = useParams();
  return <BookingForm key={id} id={id!} />;
}
function BookingForm({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  const client = useQueryClient();
  const active = usePageActive();
  const collection = collectionPath(location.state as NavigationState | null);
  const provider = useQuery({
    queryKey: ["provider", id],
    queryFn: () => api<Provider>("/providers/" + id),
    refetchInterval: 30000,
    refetchOnMount: "always",
  });
  const addresses = useQuery({
    queryKey: ["addresses"],
    queryFn: () => api<Address[]>("/addresses"),
  });
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  const form = useForm<z.infer<typeof bookingSchema>>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      addressId: search.get("addressId") ?? "",
      slotId: search.get("slotId") ?? "",
      wasteTypes: wasteTypes.filter((w) => search.getAll("waste").includes(w)),
    },
  });
  const dates = useMemo(
    () => [
      ...new Set(provider.data?.slots.map((s) => localDay(s.startAt)) ?? []),
    ],
    [provider.data],
  );
  const day = search.get("day") ?? "";
  const selectedDay = dates.includes(day) ? day : dates[0];
  function saveDraft(nextDay = selectedDay) {
    const values = form.getValues();
    const next = new URLSearchParams(search);
    for (const key of ["addressId", "slotId", "waste", "day"]) next.delete(key);
    if (values.addressId) next.set("addressId", values.addressId);
    if (values.slotId) next.set("slotId", values.slotId);
    for (const waste of values.wasteTypes) next.append("waste", waste);
    if (nextDay) next.set("day", nextDay);
    setSearch(next, { replace: true, state: location.state });
  }
  useEffect(() => {
    if (!provider.data || !addresses.data) return;
    const values = form.getValues();
    if (
      values.slotId &&
      !provider.data.slots.some(
        (s) => s.id === values.slotId && localDay(s.startAt) === selectedDay,
      )
    )
      form.setValue("slotId", "");
    if (
      values.addressId &&
      !addresses.data.some((a) => a.id === values.addressId)
    )
      form.setValue("addressId", "");
  }, [provider.data, addresses.data, selectedDay, form]);
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof bookingSchema>) => {
      const fingerprint = JSON.stringify(values);
      if (request.current?.fingerprint !== fingerprint)
        request.current = { fingerprint, key: crypto.randomUUID() };
      return post<Booking>(
        "/bookings/hold",
        { ...values, providerId: id },
        { "Idempotency-Key": request.current!.key },
      );
    },
    onSuccess: (booking) => {
      void invalidateAvailability(client);
      void client.invalidateQueries({ queryKey: ["orders"] });
      if (active.current) {
        client.setQueryData(["booking", booking.id], booking);
        navigate("/checkout/" + booking.id, {
          state: {
            backTo: location.pathname + location.search,
            collectionPath: collection,
          },
        });
      }
    },
    onError: () => {
      void invalidateAvailability(client);
    },
  });
  if (provider.isPending || addresses.isPending) return <Loading />;
  if (provider.error || addresses.error)
    return <ErrorMessage error={provider.error || addresses.error} />;
  const p = provider.data!;
  const selectedAddress = addresses.data?.find(
    (a) => a.id === form.watch("addressId"),
  );
  const supported =
    !selectedAddress ||
    p.serviceAreas.some(
      (a) =>
        a.postalCode === selectedAddress.postalCode &&
        a.city.toLowerCase() === selectedAddress.city.toLowerCase(),
    );
  return (
    <>
      <BackLink to={collection} />
      <div className="booking-intro">
        <span className="eyebrow">YOUR NEXT SMALL STEP</span>
        <h1>Let's plan your pickup.</h1>
        <p className="muted">
          A few details, and {p.name} will take care of the rest.
        </p>
      </div>
      <div className="two-column">
        <form
          className="panel booking-form"
          onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          noValidate
        >
          <section>
            <h2>
              <span className="step-number">1</span>Where are we picking up?
            </h2>
            <label htmlFor="addressId">Pickup address</label>
            <select
              id="addressId"
              {...form.register("addressId", { onChange: () => saveDraft() })}
            >
              <option value="">Select a saved address</option>
              {addresses.data?.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.label} · {a.addressLine1}, {a.postalCode}
                </option>
              ))}
            </select>
            <p className="field-error">
              {form.formState.errors.addressId?.message}
            </p>
            {!supported && (
              <p className="field-error">
                This provider doesn't serve this address. Choose another address
                or collection partner.
              </p>
            )}
            <Link
              className="text-link"
              to="/addresses"
              state={{
                backTo: location.pathname + location.search,
                collectionPath: collection,
              }}
            >
              <MapPin size={14} />
              Add or manage addresses
            </Link>
          </section>
          <section>
            <h2>
              <span className="step-number">2</span>What's ready to go?
            </h2>
            <p className="muted small">
              Choose one or more supported waste types.
            </p>
            <div className="waste-checks">
              {p.wasteTypes.map((w) => (
                <label className="check-pill" key={w.wasteType}>
                  <input
                    type="checkbox"
                    value={w.wasteType}
                    {...form.register("wasteTypes", {
                      onChange: () => saveDraft(),
                    })}
                  />
                  {wasteLabel(w.wasteType)}
                </label>
              ))}
            </div>
            <p className="field-error">
              {form.formState.errors.wasteTypes?.message}
            </p>
          </section>
          <section>
            <h2>
              <span className="step-number">3</span>Find your moment.
            </h2>
            <label htmlFor="date">Pickup date</label>
            <select
              id="date"
              value={selectedDay ?? ""}
              onChange={(e) => {
                form.setValue("slotId", "");
                saveDraft(e.target.value);
              }}
            >
              {dates.map((d) => (
                <option value={d} key={d}>
                  {dateLabel(d + "T12:00:00+05:30")}
                </option>
              ))}
            </select>
            <fieldset className="slot-fieldset">
              <legend>Available time slots · India time</legend>
              <div className="slot-grid">
                {p.slots
                  .filter((s) => localDay(s.startAt) === selectedDay)
                  .map((s) => (
                    <label key={s.id} className="slot-option">
                      <input
                        type="radio"
                        value={s.id}
                        {...form.register("slotId", {
                          onChange: () => saveDraft(),
                        })}
                      />
                      <Clock size={15} />
                      {timeLabel(s.startAt)} · {timeLabel(s.endAt)}
                    </label>
                  ))}
              </div>
              {!p.slots.length && (
                <p className="muted">
                  No slots available right now. Please choose another partner.
                </p>
              )}
            </fieldset>
            <p className="field-error">
              {form.formState.errors.slotId?.message}
            </p>
          </section>
          <ErrorMessage error={mutation.error} />
          <button
            className="button full"
            disabled={mutation.isPending || !supported || !p.slots.length}
          >
            {mutation.isPending
              ? "Reserving your slot…"
              : "Continue to payment"}
            <ArrowRight size={18} />
          </button>
          <p className="secure-caption">
            <ShieldCheck size={14} />
            Your slot is held for 10 minutes while you pay.
          </p>
        </form>
        <aside>
          <div className={"summary-art " + p.color}>
            <Leaf size={70} strokeWidth={1} />
            <span>
              ONE PICKUP.
              <br />
              PLENTY OF POSSIBILITY.
            </span>
          </div>
          <div className="panel booking-summary">
            <span className="eyebrow">YOUR COLLECTION PARTNER</span>
            <h2>{p.name}</h2>
            <p className="muted">{p.description}</p>
            <div className="summary-line">
              <MapPin size={17} />
              <span>
                {[...new Set(p.serviceAreas.map((a) => a.city))].join(" · ")}
              </span>
            </div>
            <div className="summary-line">
              <CalendarDays size={17} />
              <span>One-time doorstep collection</span>
            </div>
            <div className="price-total">
              <span>Pickup total</span>
              <strong>{money(p.price)}</strong>
            </div>
            <p className="muted small">
              Flat rate for selected waste types. No surprise fees.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
