import { ReactNode } from "react";
import {
  Leaf,
  LoaderCircle,
  AlertCircle,
  PackageOpen,
  ArrowRight,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { NavigationState } from "../routes/navigation";
export function Logo() {
  return (
    <Link className="logo" to="/providers" aria-label="Loop home">
      <span className="logo-icon">
        <Leaf size={21} />
      </span>
      loop<span className="logo-dot">.</span>
    </Link>
  );
}
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state" role="status">
      <LoaderCircle className="spin" size={26} />
      <p>{label}</p>
    </div>
  );
}
export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="error" role="alert">
      <AlertCircle size={18} />
      <span>
        {error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."}
      </span>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <PackageOpen size={36} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span
      className={
        "status " +
        (["PAID", "PROCESSING", "COMPLETED"].includes(value)
          ? "good"
          : [
                "EXPIRED",
                "PAYMENT_FAILED",
                "FAILED",
                "CANCELLED",
                "REFUND_REQUIRED",
              ].includes(value)
            ? "bad"
            : "pending")
      }
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function BackLink({
  to = "/providers",
  children = "Back to collection",
}: {
  to?: string;
  children?: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as NavigationState | null;
  return (
    <Link
      className="back-link"
      to={to}
      replace
      onClick={(event) => {
        if (
          state?.backTo === to &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          navigate(-1);
        }
      }}
    >
      <ArrowRight size={15} className="reverse" />
      {children}
    </Link>
  );
}
