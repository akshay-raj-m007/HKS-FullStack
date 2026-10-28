import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";

export interface NavigationState {
  backTo?: string;
  from?: string;
  collectionPath?: string;
}

export function appPath(value: unknown, fallback = "/providers") {
  return typeof value === "string" &&
    /^\/(providers|addresses|orders|checkout|payment-result|ask)(\/|\?|#|$)/.test(
      value,
    ) &&
    !value.includes("\\")
    ? value
    : fallback;
}

export function collectionPath(state: NavigationState | null) {
  const path = appPath(state?.collectionPath);
  return /^\/providers(\?|#|$)/.test(path) ? path : "/providers";
}

/** Async work may update caches after navigation, but must not redirect a departed page. */
export function usePageActive() {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return active;
}

export function invalidateAvailability(client: QueryClient) {
  return Promise.all([
    client.invalidateQueries({ queryKey: ["providers"] }),
    client.invalidateQueries({ queryKey: ["provider"] }),
  ]);
}
