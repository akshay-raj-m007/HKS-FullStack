import { Link, useLocation } from "react-router-dom";
import {
  ArrowUpRight,
  Star,
  MapPin,
  Recycle,
  Leaf,
  Cpu,
  Package,
  Newspaper,
} from "lucide-react";
import type { Provider } from "../../types";
import { money, wasteLabel, dateLabel, timeLabel } from "../../utils/format";
const icons = {
  sage: Recycle,
  peach: Leaf,
  lavender: Cpu,
  sand: Package,
  sky: Newspaper,
};
export function ProviderCard({ provider }: { provider: Provider }) {
  const location = useLocation();
  const from = location.pathname + location.search + location.hash;
  const Icon = icons[provider.color as keyof typeof icons] ?? Recycle;
  const slot = provider.slots[0];
  return (
    <article className="provider-card">
      <div className={"provider-art " + provider.color}>
        <span className="art-circle" />
        <Icon className="provider-symbol" size={71} strokeWidth={1.3} />
        <span className="rating">
          <Star size={12} fill="currentColor" />
          {provider.rating.toFixed(1)}
          <span className="rating-demo"> demo</span>
        </span>
        <span className="art-caption">A SECOND LIFE STARTS HERE</span>
      </div>
      <div className="provider-body">
        <div className="provider-title">
          <h3>{provider.name}</h3>
          <span className="provider-mark">
            <Leaf size={15} />
          </span>
        </div>
        <p className="provider-description">{provider.description}</p>
        <div className="tags">
          {provider.wasteTypes.map((w) => (
            <span key={w.wasteType}>{wasteLabel(w.wasteType)}</span>
          ))}
        </div>
        <p className="provider-location">
          <MapPin size={14} />
          {[...new Set(provider.serviceAreas.map((a) => a.city))].join(" · ")}
        </p>
        <p className="next-slot">
          {slot
            ? dateLabel(slot.startAt) +
              " · " +
              timeLabel(slot.startAt) +
              " · " +
              timeLabel(slot.endAt)
            : "More availability coming soon"}
        </p>
        <div className="provider-bottom">
          <div>
            <strong>{money(provider.price)}</strong>
            <span> / pickup</span>
          </div>
          <Link
            className="small-button"
            to={"/providers/" + provider.id}
            state={{ backTo: from, collectionPath: from }}
          >
            View slots
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </div>
    </article>
  );
}
