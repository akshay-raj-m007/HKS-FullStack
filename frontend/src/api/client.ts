import type { User } from "../types";
import { ApiError } from "./error";
export { ApiError } from "./error";
const base = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
let accessToken: string | null = null;
let refreshPromise: Promise<Session> | null = null;
export interface Session {
  user: User;
  accessToken: string;
}
export const setAccessToken = (token: string | null) => {
  accessToken = token;
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
      result.error?.code ?? "REQUEST_FAILED",
      result.error?.message ?? "Unable to complete this request.",
    );
  return result.data as T;
}
export function refreshSession() {
  if (!refreshPromise)
    refreshPromise = raw<Session>("/auth/refresh", {
      method: "POST",
      body: "{}",
    })
      .then((session) => {
        setAccessToken(session.accessToken);
        return session;
      })
      .finally(() => {
        refreshPromise = null;
      });
  return refreshPromise;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  try {
    return await raw<T>(path, options);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      !path.startsWith("/auth/")
    ) {
      try {
        await refreshSession();
      } catch {
        setAccessToken(null);
        window.dispatchEvent(new Event("session-expired"));
        throw error;
      }
      return raw<T>(path, options);
    }
    throw error;
  }
}
export const post = <T>(path: string, data: unknown, headers?: HeadersInit) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data), headers });
