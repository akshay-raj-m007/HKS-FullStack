import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  MapPin,
  ArrowUpRight,
  Leaf,
  Recycle,
  Apple,
  Sprout,
  Newspaper,
  Cpu,
  Trash2,
  SlidersHorizontal,
  CalendarDays,
} from "lucide-react";
import { api } from "../../api/client";
import type { Provider, Address } from "../../types";
import { PageHeading, Loading, ErrorMessage, Empty } from "../../components/ui";
import { ProviderCard } from "./ProviderCard";
const categories = [
  { value: "", label: "All waste", icon: Recycle },
  { value: "PLASTIC", label: "Plastic", icon: Recycle },
  { value: "FOOD", label: "Food waste", icon: Apple },
  { value: "GREEN_WASTE", label: "Garden", icon: Sprout },
  { value: "PAPER", label: "Paper", icon: Newspaper },
  { value: "ELECTRONIC", label: "E-waste", icon: Cpu },
  { value: "GENERAL", label: "General", icon: Trash2 },
];
export function ProvidersPage() {
  const [search, setSearch] = useSearchParams();
  const waste = search.get("wasteType") ?? "",
    location = search.get("location") ?? "",
    date = search.get("date") ?? "",
    slot = search.get("slot") ?? "";
  function filter(key: string, value: string) {
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }
  const addresses = useQuery({
    queryKey: ["addresses"],
    queryFn: () => api<Address[]>("/addresses"),
  });
  const params = new URLSearchParams();
  if (waste) params.set("wasteType", waste);
  if (location) params.set("location", location);
  if (date) params.set("date", date);
  if (slot) params.set("slot", slot);
  const providers = useQuery({
    queryKey: ["providers", waste, location, date, slot],
    queryFn: () => api<Provider[]>("/providers?" + params),
    refetchInterval: 30000,
    refetchOnMount: "always",
  });
  return (
    <>
      <PageHeading
        eyebrow="YOUR HOME, A LITTLE LIGHTER"
        title="Good things start with a pickup."
        description="Find a local collection partner and give your waste a better next chapter."
      >
        <Link className="location-link" to="/addresses">
          <MapPin size={17} />
          {addresses.data?.[0]?.label ?? "Add pickup address"}
          <ArrowUpRight size={15} />
        </Link>
      </PageHeading>
      <section className="hero">
        <div className="hero-copy">
          <span className="pill">
            <span className="tiny-dot" /> SMALL HABITS. BIG DIFFERENCE.
          </span>
          <h2>
            Less in the bin.
            <br />
            More for the planet.
          </h2>
          <p>
            From kitchen scraps to yesterday's paper,
            <br className="desktop-break" /> a cleaner tomorrow is one pickup
            away.
          </p>
          <a
            href="#collection"
            className="hero-link"
            onClick={(event) => {
              event.preventDefault();
              document
                .getElementById("collection")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Find your collection partner
            <ArrowUpRight size={18} />
          </a>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-sun" />
          <div className="hero-ring" />
          <div className="hero-bin hero-bin-paper">
            <Newspaper size={51} strokeWidth={1.3} />
            <span>PAPER</span>
          </div>
          <div className="hero-bin hero-bin-plastic">
            <Recycle size={56} strokeWidth={1.3} />
            <span>RECYCLE</span>
          </div>
          <div className="hero-leaf">
            <Leaf size={96} strokeWidth={1.4} />
          </div>
          <span className="hero-sticker">
            <Sprout size={19} />
            Every little bit counts.
          </span>
        </div>
      </section>
      <div className="section-heading" id="collection">
        <div>
          <h2>What are we collecting?</h2>
          <p className="muted">A place for every kind of waste.</p>
        </div>
        <span className="collection-note">
          <Leaf size={15} /> Thoughtful collection, made simple
        </span>
      </div>
      <div className="categories" role="group" aria-label="Waste type">
        {categories.map((c) => (
          <button
            key={c.value}
            className={waste === c.value ? "category selected" : "category"}
            aria-pressed={waste === c.value}
            onClick={() => filter("wasteType", c.value)}
          >
            <c.icon size={20} />
            {c.label}
          </button>
        ))}
      </div>
      <div className="filters">
        <span className="filter-label">
          <SlidersHorizontal size={16} />
          Refine your pickup
        </span>
        <label className="filter-control">
          <MapPin size={15} />
          <span className="sr-only">Location</span>
          <select
            value={location}
            onChange={(e) => filter("location", e.target.value)}
          >
            <option value="">All service areas</option>
            <option>Bengaluru</option>
            <option>Mysuru</option>
          </select>
        </label>
        <label className="filter-control">
          <CalendarDays size={15} />
          <span className="sr-only">Pickup date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => filter("date", e.target.value)}
          />
        </label>
        <label className="filter-control">
          <span className="sr-only">Time of day</span>
          <select value={slot} onChange={(e) => filter("slot", e.target.value)}>
            <option value="">Any time</option>
            <option value="morning">Morning</option>
            <option value="afternoon">Afternoon</option>
          </select>
        </label>
        {(waste || location || date || slot) && (
          <button className="text-button" onClick={() => setSearch({})}>
            Reset
          </button>
        )}
      </div>
      <div className="results-heading">
        <h2>
          Collection partners <span>{providers.data?.length ?? "—"}</span>
        </h2>
        <span className="muted">One-time pickups. No subscriptions.</span>
      </div>
      <ErrorMessage error={providers.error} />
      {providers.isPending ? (
        <Loading label="Finding collection partners…" />
      ) : providers.data?.length ? (
        <div className="provider-grid">
          {providers.data.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </div>
      ) : (
        !providers.error && (
          <Empty title="No partners for these filters">
            <p>Try another date, location, or waste type.</p>
          </Empty>
        )
      )}
      <aside className="help-strip">
        <span className="help-icon">
          <Sprout size={25} />
        </span>
        <div>
          <h3>A little sorting goes a long way.</h3>
          <p>
            Keep recyclables clean and dry. Separate food waste before your
            partner arrives.
          </p>
        </div>
        <span className="pill subtle">A small act of care</span>
      </aside>
    </>
  );
}
