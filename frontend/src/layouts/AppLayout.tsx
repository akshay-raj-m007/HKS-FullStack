import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { MapPin, Package, Grid2X2, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "../features/auth/AuthContext";
import { Logo, ErrorMessage } from "../components/ui";
export function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [error, setError] = useState<{ key: string; cause: unknown } | null>(
    null,
  );
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    setError(null);
  }, [location.key]);
  return (
    <>
      <header className="header">
        <div className="header-inner">
          <Logo />
          <nav aria-label="Main navigation">
            <NavLink to="/providers">
              <Grid2X2 size={17} />
              Collection
            </NavLink>
            <NavLink to="/orders">
              <Package size={17} />
              My pickups
            </NavLink>
            <NavLink to="/addresses">
              <MapPin size={17} />
              Addresses
            </NavLink>
          </nav>
          <div className="account">
            <span className="avatar">
              {import.meta.env.VITE_PUBLIC_DEMO_MODE === "true"
                ? "DG"
                : user?.phone.slice(-2)}
            </span>
            <span className="account-phone">
              {import.meta.env.VITE_PUBLIC_DEMO_MODE === "true"
                ? "Demo guest"
                : user?.phone}
            </span>
            <button
              className="icon-button"
              aria-label="Sign out"
              disabled={signingOut}
              onClick={() => {
                setSigningOut(true);
                void logout()
                  .catch((cause) => setError({ key: location.key, cause }))
                  .finally(() => setSigningOut(false));
              }}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>
      <main className="main">
        <ErrorMessage
          error={error?.key === location.key ? error.cause : null}
        />
        <Outlet />
      </main>
      <footer className="footer">
        <span>Small steps. A cleaner tomorrow.</span>
        <span>
          <ShieldCheck size={15} />{" "}
          {import.meta.env.VITE_DEMO_MODE === "true" ||
          import.meta.env.VITE_PUBLIC_DEMO_MODE === "true"
            ? "Interactive demo · simulated payments"
            : "Local development · sandbox payments"}
        </span>
        <span>Made for a little less waste.</span>
      </footer>
    </>
  );
}
