import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Camera, Leaf, X, ArrowRight } from "lucide-react";
import { api } from "../../api/client";
import { PageHeading, ErrorMessage, Loading } from "../../components/ui";
import { wasteTypes, type WasteType, type Address } from "../../types";
import {
  localDay,
  dateLabel,
  timeLabel,
  money,
  wasteLabel,
} from "../../utils/format";
import type { Capability, PhotoResult, SearchResult } from "./types";
import "./ask-loop.css";

export function AskLoopPage() {
  const capability = useQuery({
    queryKey: ["assistant-capabilities"],
    queryFn: () => api<Capability>("/assistant/capabilities"),
    retry: false,
    staleTime: 30000,
  });
  const addresses = useQuery({
    queryKey: ["addresses"],
    queryFn: () => api<Address[]>("/addresses"),
    enabled: !!capability.data?.enabled,
  });
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const [materials, setMaterials] = useState<WasteType[]>([]);
  const [addressId, setAddressId] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState("");
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  const [observation, setObservation] = useState<PhotoResult | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"photo" | "search" | null>(null);
  const request = useRef<{ id: number; controller: AbortController } | null>(
    null,
  );
  const serial = useRef(0);
  const heading = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const retry = useRef<(() => void) | null>(null);
  useEffect(() => {
    const title = heading.current?.querySelector("h1");
    title?.setAttribute("tabindex", "-1");
    title?.focus();
    return () => {
      serial.current++;
      request.current?.controller.abort();
    };
  }, []);
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );
  const unresolved =
    !!observation &&
    (!!observation.unresolvedItems.length ||
      observation.items.some(
        (item) => !item.category || item.certainty === "uncertain",
      ));
  const photoReady =
    !photo || (!!observation && confirmed && (!unresolved || acknowledged));
  function cancel() {
    serial.current++;
    request.current?.controller.abort();
    request.current = null;
    setBusy(null);
  }
  function removePhoto(clearInput = true) {
    cancel();
    retry.current = null;
    setError(null);
    setPhoto(null);
    setObservation(null);
    setMaterials([]);
    setConfirmed(false);
    setAcknowledged(false);
    setConsent(false);
    setResult(null);
    if (clearInput && fileInput.current) fileInput.current.value = "";
  }
  async function run<T>(
    kind: "photo" | "search",
    work: (signal: AbortSignal) => Promise<T>,
    apply: (value: T) => void,
  ) {
    if (request.current) return;
    const controller = new AbortController();
    const id = ++serial.current;
    request.current = { id, controller };
    setBusy(kind);
    setError(null);
    setResult(null);
    try {
      const value = await work(controller.signal);
      if (id === serial.current && !controller.signal.aborted) apply(value);
    } catch (cause) {
      if (id === serial.current && !controller.signal.aborted) setError(cause);
    } finally {
      if (id === serial.current) {
        request.current = null;
        setBusy(null);
      }
    }
  }
  function analyze() {
    if (!photo || !consent || !capability.data?.photo) return;
    retry.current = analyze;
    setObservation(null);
    setConfirmed(false);
    setAcknowledged(false);
    void run(
      "photo",
      async (signal) => {
        const image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          const abort = () => {
            reader.abort();
            reject(new DOMException("Cancelled", "AbortError"));
          };
          signal.addEventListener("abort", abort, { once: true });
          reader.onload = () => {
            signal.removeEventListener("abort", abort);
            resolve(String(reader.result).split(",")[1]);
          };
          reader.onerror = () => {
            signal.removeEventListener("abort", abort);
            reject(new Error("The image could not be read. Try another file."));
          };
          reader.readAsDataURL(photo.file);
        });
        signal.throwIfAborted();
        return api<PhotoResult>("/assistant/photo", {
          method: "POST",
          body: JSON.stringify({ image, consent: true }),
          signal,
        });
      },
      (value) => {
        setObservation(value);
        setMaterials([
          ...new Set(
            value.items.flatMap((item) =>
              item.category ? [item.category] : [],
            ),
          ),
        ]);
        setConfirmed(false);
        setAcknowledged(false);
      },
    );
  }
  function search() {
    if (!capability.data?.chat || !photoReady || request.current) return;
    retry.current = search;
    const text =
      message.trim() || "Find pickup options for my selected materials.";
    void run(
      "search",
      (signal) =>
        api<SearchResult>("/assistant/search", {
          method: "POST",
          signal,
          body: JSON.stringify({
            message: text,
            history,
            materials,
            ...(addressId
              ? { addressId }
              : location.trim()
                ? { location: location.trim() }
                : {}),
            ...(date ? { date } : {}),
            ...(photo && observation
              ? {
                  photoConfirmation: {
                    token: observation.confirmationToken,
                    confirmed,
                    acknowledgeUnresolved: acknowledged,
                  },
                }
              : {}),
          }),
        }),
      (value) => {
        setResult(value);
        setHistory((previous) =>
          [
            ...previous,
            { role: "user" as const, text: text.slice(0, 500) },
            { role: "assistant" as const, text: value.message.slice(0, 500) },
          ].slice(-6),
        );
      },
    );
  }
  const available = capability.data?.enabled;
  return (
    <div className="ask-loop" ref={heading}>
      <PageHeading
        eyebrow="A LITTLE HELP WITH YOUR PICKUP"
        title="Ask Loop"
        description="Check a waste photo or describe your materials, location and preferred time. You stay in control of booking."
      />
      <Link className="text-link" to="/providers">
        Use manual collection search <ArrowRight size={15} />
      </Link>
      {capability.isPending ? (
        <Loading label="Checking assistant availability…" />
      ) : !available ? (
        <section className="panel ask-unavailable" role="status">
          <Leaf />
          <h2>Ask Loop is currently unavailable.</h2>
          <p>
            Ordinary collection search, saved addresses and booking still work.
            Please use manual search.
          </p>
          <button
            className="button secondary"
            onClick={() => void capability.refetch()}
          >
            Check again
          </button>
        </section>
      ) : (
        <div className="ask-columns">
          <section className="panel" aria-label="Ask Loop search">
            <p className="muted small">
              Messages and approved photos are sent to NVIDIA for analysis. Use
              address labels or city/postal code rather than personal details.
              Photos are processed transiently and are not saved by Loop.
            </p>
            <label htmlFor="ask-photo">
              Waste photo (optional, JPEG/PNG/WebP, up to 2 MiB)
            </label>
            <input
              id="ask-photo"
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={!!busy || !capability.data?.photo}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                removePhoto(false);
                setError(null);
                if (
                  file.size > 2 * 1024 * 1024 ||
                  !["image/jpeg", "image/png", "image/webp"].includes(file.type)
                ) {
                  event.target.value = "";
                  setError(
                    new Error(
                      "Choose one JPEG, PNG or WebP image no larger than 2 MiB.",
                    ),
                  );
                  return;
                }
                setPhoto({ file, url: URL.createObjectURL(file) });
              }}
            />
            {!capability.data?.photo && (
              <p className="muted small">
                Photo analysis is unavailable. You can still describe your
                materials.
              </p>
            )}
            {photo && (
              <div className="ask-photo">
                <img
                  src={photo.url}
                  alt="Selected waste photo for your review"
                />
                <button className="text-button" onClick={() => removePhoto()}>
                  <X size={16} />
                  Remove photo
                </button>
                <label className="ask-check">
                  <input
                    type="checkbox"
                    checked={consent}
                    disabled={!!busy}
                    onChange={(event) => setConsent(event.target.checked)}
                  />
                  I agree to send this photo to NVIDIA for analysis.
                </label>
                <button
                  className="button secondary"
                  disabled={!!busy || !consent}
                  onClick={analyze}
                >
                  <Camera size={16} />
                  Analyze photo
                </button>
              </div>
            )}
            {observation && (
              <section aria-label="Photo suggestions">
                <h2>Review suggested materials</h2>
                <p>{observation.message}</p>
                <ul>
                  {observation.items.map((item, index) => (
                    <li key={index}>
                      {item.label} —{" "}
                      {item.category ? wasteLabel(item.category) : "Unresolved"}{" "}
                      ({item.certainty})
                    </li>
                  ))}
                </ul>
                {unresolved && (
                  <div className="ask-warning">
                    <strong>Some items need clarification.</strong>
                    <ul>
                      {[
                        ...observation.unresolvedItems,
                        ...observation.questions,
                      ].map((text, index) => (
                        <li key={index}>{text}</li>
                      ))}
                    </ul>
                    <p>
                      The catalog only confirms broad categories, not detailed
                      acceptance policies.
                    </p>
                  </div>
                )}
              </section>
            )}
            <fieldset disabled={!!busy}>
              <legend>Materials — select or correct every category</legend>
              <div className="waste-checks">
                {wasteTypes.map((waste) => (
                  <label className="check-pill" key={waste}>
                    <input
                      type="checkbox"
                      checked={materials.includes(waste)}
                      onChange={(event) => {
                        setMaterials((current) =>
                          event.target.checked
                            ? [...current, waste]
                            : current.filter((value) => value !== waste),
                        );
                        setConfirmed(false);
                        setResult(null);
                      }}
                    />
                    {wasteLabel(waste)}
                  </label>
                ))}
              </div>
            </fieldset>
            {observation && (
              <>
                <label className="ask-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={!!busy}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  I reviewed and confirm the selected materials.
                </label>
                {unresolved && (
                  <label className="ask-check">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      disabled={!!busy}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                    />
                    I understand unresolved items still need manual
                    clarification. Search only the categories I selected.
                  </label>
                )}
              </>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                search();
              }}
            >
              <label htmlFor="ask-message">What needs collecting?</label>
              <textarea
                id="ask-message"
                rows={4}
                maxLength={1000}
                value={message}
                disabled={!!busy}
                onChange={(event) => {
                  setMessage(event.target.value);
                  setResult(null);
                }}
                placeholder="Paper and plastic at Home tomorrow after 4 PM, cheapest first"
              />
              <label htmlFor="ask-address">
                Saved pickup address (optional)
              </label>
              <select
                id="ask-address"
                value={addressId}
                disabled={!!busy}
                onChange={(event) => {
                  setAddressId(event.target.value);
                  setResult(null);
                }}
              >
                <option value="">Resolve from my message or location</option>
                {addresses.data?.map((address) => (
                  <option key={address.id} value={address.id}>
                    {address.label} · {address.city} {address.postalCode}
                  </option>
                ))}
              </select>
              <ErrorMessage error={addresses.error} />
              <label htmlFor="ask-location">
                City or postal code (when no saved address is chosen)
              </label>
              <input
                id="ask-location"
                value={location}
                maxLength={80}
                disabled={!!busy || !!addressId}
                onChange={(event) => {
                  setLocation(event.target.value);
                  setResult(null);
                }}
              />
              <label htmlFor="ask-date">
                Pickup date (India time, optional)
              </label>
              <input
                id="ask-date"
                type="date"
                value={date}
                min={localDay(new Date().toISOString())}
                disabled={!!busy}
                onChange={(event) => {
                  setDate(event.target.value);
                  setResult(null);
                }}
              />
              <ErrorMessage error={error} />
              {error != null && (
                <button
                  type="button"
                  className="text-button"
                  disabled={!!busy}
                  onClick={() => retry.current?.()}
                >
                  Retry last request
                </button>
              )}
              <div className="ask-actions">
                <button
                  className="button"
                  disabled={
                    !!busy ||
                    !photoReady ||
                    (!message.trim() && !materials.length)
                  }
                >
                  Find pickup options <ArrowRight size={16} />
                </button>
                {busy && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={cancel}
                  >
                    Cancel analysis
                  </button>
                )}
              </div>
              {photo && !photoReady && (
                <p className="input-hint">
                  Analyze the photo and review/confirm materials before
                  searching, or remove it to search manually.
                </p>
              )}
            </form>
          </section>
          <section
            className="panel ask-results"
            aria-label="Assistant results"
            aria-busy={!!busy}
          >
            <h2>Your pickup options</h2>
            <div role="status" aria-live="polite">
              {busy ? (
                <Loading
                  label={
                    busy === "photo"
                      ? "Checking your photo…"
                      : "Checking live providers and slots…"
                  }
                />
              ) : result ? (
                <p>{result.message}</p>
              ) : (
                <p className="muted">
                  Suggestions and live collection options will appear here. Ask
                  Loop cannot reserve, cancel, edit addresses or make payments.
                </p>
              )}
            </div>
            {result?.date && (
              <p>
                <strong>{dateLabel(result.date + "T12:00:00+05:30")}</strong> ·{" "}
                {result.timezone}
              </p>
            )}
            {result?.navigation && (
              <Link className="button secondary" to={result.navigation.path}>
                {result.navigation.label}
              </Link>
            )}
            {result?.providers.map((provider) => (
              <article key={provider.id} className="ask-provider">
                <h3>{provider.name}</h3>
                <p>{money(provider.price)} per pickup</p>
                {provider.slots.map((slot) => {
                  const draft = new URLSearchParams({
                    slotId: slot.id,
                    day: localDay(slot.startAt),
                  });
                  if (result.addressId)
                    draft.set("addressId", result.addressId);
                  for (const waste of result.materials ?? [])
                    draft.append("waste", waste);
                  return (
                    <Link
                      key={slot.id}
                      className="button secondary ask-slot"
                      to={"/providers/" + provider.id + "?" + draft}
                      state={{ collectionPath: "/providers", backTo: "/ask" }}
                    >
                      Review pickup: {timeLabel(slot.startAt)}–
                      {timeLabel(slot.endAt)}
                    </Link>
                  );
                })}
              </article>
            ))}
            <p className="secure-caption">
              Options are provisional. The existing booking form rechecks the
              slot and server price. Sandbox only; no real dispatch or money
              movement.
            </p>
            {!!history.length && (
              <details>
                <summary>Recent conversation (this page only)</summary>
                <ol>
                  {history.map((entry, index) => (
                    <li key={index}>
                      <strong>{entry.role === "user" ? "You" : "Loop"}:</strong>{" "}
                      {entry.text}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
