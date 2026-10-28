import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/** Keep scroll positions per history entry, including pages that load asynchronously. */
export function RouteScroll() {
  const location = useLocation();
  const navigation = useNavigationType();
  const positions = useRef(new Map<string, number>());
  const previous = useRef(location);

  useEffect(() => {
    const original = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = original;
    };
  }, []);

  useLayoutEffect(() => {
    const old = previous.current;
    previous.current = location;
    const changedPage = old.pathname !== location.pathname;
    const saved = positions.current.get(location.key);
    const target = navigation === "POP" ? (saved ?? 0) : 0;
    let restoring = changedPage || navigation === "POP";
    let observer: ResizeObserver | undefined;
    const remember = () => {
      if (!restoring) positions.current.set(location.key, window.scrollY);
    };
    const stopRestoring = () => {
      restoring = false;
      observer?.disconnect();
    };
    const restore = () => {
      if (!restoring) return;
      if (location.hash && saved === undefined) {
        let id = location.hash.slice(1);
        try {
          id = decodeURIComponent(id);
        } catch {
          /* Use the literal malformed fragment. */
        }
        const anchor = document.getElementById(id);
        if (anchor) {
          anchor.scrollIntoView();
          stopRestoring();
        }
      } else {
        window.scrollTo({ top: target, behavior: "instant" });
        if (Math.abs(window.scrollY - target) < 2) stopRestoring();
      }
    };
    if (restoring) {
      observer = new ResizeObserver(restore);
      observer.observe(document.body);
      restore();
    }
    remember();
    window.addEventListener("scroll", remember, { passive: true });
    window.addEventListener("wheel", stopRestoring, { passive: true });
    window.addEventListener("touchstart", stopRestoring, { passive: true });
    window.addEventListener("keydown", stopRestoring);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", remember);
      window.removeEventListener("wheel", stopRestoring);
      window.removeEventListener("touchstart", stopRestoring);
      window.removeEventListener("keydown", stopRestoring);
    };
  }, [location, navigation]);
  return null;
}
