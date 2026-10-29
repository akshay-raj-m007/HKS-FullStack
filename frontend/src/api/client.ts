import type { User } from "../types";
import { ApiError } from "./error";
export { ApiError } from "./error";
const base = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
let accessToken: string | null = null;
let refreshPromise: Promise<Session> | null = null;
let sessionVersion = 0;
let sessionUserId: string | null = null;
const sessionChanged = () =>
  new ApiError(
    401,
    "SESSION_CHANGED",
    "Your sign-in changed. Please try again.",
  );
export interface Session {
  user: User;
  accessToken: string;
}
export const setAccessToken = (token: string | null, userId?: string) => {
  sessionVersion++;
  refreshPromise = null;
  accessToken = token;
  sessionUserId = token ? (userId ?? null) : null;
};
async function raw<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (import.meta.env.VITE_DEMO_MODE === "true") {
    const { demoRequest } = await import("../demo/api");
    return (await demoRequest(path, options)) as T;
  }
  const response = await fetch(base + path, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "Loop",
      ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const result = await response.json().catch(() => ({
    error: {
      code: "NETWORK_ERROR",
      message: "The server returned an unexpected response.",
    },
  }));
  if (!response.ok)
    throw new ApiError(
      response.status,
      result?.error?.code ?? "REQUEST_FAILED",
      result?.error?.message ?? "Unable to complete this request.",
    );
  if (!result || typeof result !== "object" || !("data" in result))
    throw new ApiError(
      502,
      "INVALID_RESPONSE",
      "The server returned an unexpected response. Please try again.",
    );
  return result.data as T;
}
export function refreshSession() {
  if (!refreshPromise) {
    const version = sessionVersion;
    const pending = raw<Session>("/auth/refresh", {
      method: "POST",
      body: "{}",
    })
      .then((session) => {
        if (version !== sessionVersion) throw sessionChanged();
        // A shared cookie can change when another tab signs into another account.
        // Never silently mix that account with this tab's user/cache state.
        if (sessionUserId && session.user.id !== sessionUserId)
          throw sessionChanged();
        sessionUserId = session.user.id;
        // Rotation stays within the same login; explicit sign-in/out changes it.
        accessToken = session.accessToken;
        return session;
      })
      .finally(() => {
        if (refreshPromise === pending) refreshPromise = null;
      });
    refreshPromise = pending;
  }
  return refreshPromise;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const version = sessionVersion;
  const currentRequest = async () => {
    const data = await raw<T>(path, options);
    if (version !== sessionVersion) throw sessionChanged();
    return data;
  };
  try {
    return await currentRequest();
  } catch (error) {
    if (version !== sessionVersion) throw sessionChanged();
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      !path.startsWith("/auth/")
    ) {
      try {
        await refreshSession();
      } catch {
        if (version !== sessionVersion) throw sessionChanged();
        setAccessToken(null);
        window.dispatchEvent(new Event("session-expired"));
        throw error;
      }
      if (version !== sessionVersion) throw sessionChanged();
      return currentRequest();
    }
    throw error;
  }
}
export const post = <T>(path: string, data: unknown, headers?: HeadersInit) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data), headers });
