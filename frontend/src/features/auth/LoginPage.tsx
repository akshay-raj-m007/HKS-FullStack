import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Navigate, useLocation, useNavigate, Link } from "react-router-dom";
import {
  ArrowRight,
  Leaf,
  ShieldCheck,
  Recycle,
  Sprout,
  Truck,
} from "lucide-react";
import { post, Session } from "../../api/client";
import { useAuth } from "./AuthContext";
import { Logo, ErrorMessage, Loading } from "../../components/ui";
import { mobileNumber } from "../../schemas/forms";
import {
  appPath,
  usePageActive,
  type NavigationState,
} from "../../routes/navigation";
const phoneSchema = z.object({
  phone: mobileNumber,
});
const otpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the six-digit code."),
});
type Challenge = { challengeId: string; phone: string; resendAt: number };
export function LoginPage() {
  const location = useLocation();
  return <LoginForm key={location.key} />;
}
function LoginForm() {
  const { user, signIn, loading } = useAuth(),
    navigate = useNavigate(),
    location = useLocation();
  const state = location.state as
    (NavigationState & { challenge?: Challenge; phone?: string }) | null;
  const challenge = state?.challenge ?? null;
  const destination = appPath(state?.from);
  const active = usePageActive();
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now());
  const phoneForm = useForm<z.infer<typeof phoneSchema>>({
    resolver: zodResolver(phoneSchema),
    defaultValues: { phone: state?.phone ?? challenge?.phone ?? "+91 " },
  });
  const otpForm = useForm<z.infer<typeof otpSchema>>({
    resolver: zodResolver(otpSchema),
  });
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (loading) return <Loading label="Restoring your session…" />;
  if (user) return <Navigate to={destination} replace />;
  if (location.pathname === "/verify" && !challenge)
    return <Navigate to="/login" replace state={{ from: destination }} />;
  if (
    import.meta.env.VITE_DEMO_MODE === "true" ||
    import.meta.env.VITE_PUBLIC_DEMO_MODE === "true"
  )
    return (
      <div className="auth-form-panel demo-login">
        <Logo />
        <h1>Explore Loop.</h1>
        <p>
          Browse collection partners, book a sample pickup and try simulated
          payments. No sign-up or OTP is needed.
        </p>
        <ErrorMessage error={error} />
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void post<Session>("/auth/demo", {})
              .then((session) => {
                if (!active.current) return;
                signIn(session);
                navigate(destination, { replace: true });
              })
              .catch(setError)
              .finally(() => {
                if (active.current) setBusy(false);
              });
          }}
        >
          Open interactive demo <ArrowRight size={18} />
        </button>
      </div>
    );
  const request = async (phone: string) => {
    setError(null);
    setBusy(true);
    try {
      const data = await post<{ challengeId: string; resendAfter: number }>(
        "/auth/request-otp",
        { phone },
      );
      const next = {
        phone,
        challengeId: data.challengeId,
        resendAt: Date.now() + data.resendAfter * 1000,
      };
      if (!active.current) return;
      otpForm.reset();
      navigate("/verify", {
        replace: location.pathname === "/verify",
        state: { challenge: next, from: destination },
      });
    } catch (e) {
      if (active.current) setError(e);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const verify = otpForm.handleSubmit(async ({ code }) => {
    if (!challenge) return;
    setError(null);
    setBusy(true);
    try {
      const session = await post<Session>("/auth/verify-otp", {
        phone: challenge.phone,
        challengeId: challenge.challengeId,
        code,
      });
      if (!active.current) return;
      signIn(session);
      navigate(destination, { replace: true });
    } catch (e) {
      if (active.current) setError(e);
    } finally {
      if (active.current) setBusy(false);
    }
  });
  const verifying = location.pathname === "/verify" && challenge;
  return (
    <div className="auth-shell">
      <section className="auth-story">
        <Logo />
        <div className="auth-story-copy">
          <span className="eyebrow light">
            GOOD FOR YOUR HOME. BETTER FOR THE PLANET.
          </span>
          <h1>
            A little less waste.
            <br />A lot more good.
          </h1>
          <p>
            Thoughtful waste collection, right from your doorstep. Find your
            provider. Pick your time. We'll take it from here.
          </p>
          <div className="garden-illustration" aria-hidden="true">
            <div className="sun" />
            <div className="orbit" />
            <div className="bin bin-one">
              <Recycle size={49} />
            </div>
            <div className="bin bin-two">
              <Sprout size={49} />
            </div>
            <div className="plant">
              <Leaf size={95} />
            </div>
            <span className="floating-label">
              <Truck size={17} /> A fresh start, collected.
            </span>
          </div>
        </div>
        <p className="auth-bottom">
          A cleaner neighbourhood starts at your doorstep.
        </p>
      </section>
      <section className="auth-form-panel">
        <span className="pill subtle">
          <Leaf size={14} /> Welcome to your greener routine
        </span>
        <h2>{verifying ? "Check your code." : "Let's make room for good."}</h2>
        <p className="muted">
          {verifying
            ? "Enter the six-digit code for " + challenge.phone
            : "Sign in with your mobile number to book your first pickup."}
        </p>
        <ErrorMessage error={error} />
        {verifying ? (
          <form key="otp" onSubmit={verify} noValidate>
            <label htmlFor="code">Verification code</label>
            <input
              id="code"
              className="otp-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
              {...otpForm.register("code")}
              aria-invalid={!!otpForm.formState.errors.code}
            />
            {otpForm.formState.errors.code && (
              <p className="field-error">
                {otpForm.formState.errors.code.message}
              </p>
            )}
            <p className="dev-note">
              Development mode: your random code appears in the backend
              terminal. It expires in 5 minutes.
            </p>
            <button className="button full" disabled={busy}>
              {busy ? "Verifying…" : "Verify & continue"}
              <ArrowRight size={18} />
            </button>
            <div className="form-links">
              <button
                type="button"
                className="text-button"
                disabled={busy || now < challenge.resendAt}
                onClick={() => void request(challenge.phone)}
              >
                {now < challenge.resendAt
                  ? "Resend in " +
                    Math.ceil((challenge.resendAt - now) / 1000) +
                    "s"
                  : "Resend code"}
              </button>
              <Link
                to="/login"
                replace
                state={{ phone: challenge.phone, from: destination }}
              >
                Change number
              </Link>
            </div>
          </form>
        ) : (
          <form
            key="phone"
            onSubmit={phoneForm.handleSubmit(({ phone }) => request(phone))}
            noValidate
          >
            <label htmlFor="phone">Mobile number</label>
            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              {...phoneForm.register("phone")}
              aria-invalid={!!phoneForm.formState.errors.phone}
            />
            {phoneForm.formState.errors.phone && (
              <p className="field-error">
                {phoneForm.formState.errors.phone.message}
              </p>
            )}
            <p className="input-hint">
              We'll use a one-time code. No passwords to remember.
            </p>
            <button className="button full" disabled={busy}>
              {busy ? "Sending code…" : "Get verification code"}
              <ArrowRight size={18} />
            </button>
          </form>
        )}
        <p className="auth-trust">
          <ShieldCheck size={17} /> Your number stays private and secure.
        </p>
        <div className="auth-steps">
          <span>
            01 <b>Choose</b>
          </span>
          <span>
            02 <b>Schedule</b>
          </span>
          <span>
            03 <b>Relax</b>
          </span>
        </div>
      </section>
    </div>
  );
}
