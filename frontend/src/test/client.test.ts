import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, refreshSession, setAccessToken } from "../api/client";
const reply = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { data }
        : { error: { code: "UNAUTHORIZED", message: "Sign in" } },
    ),
    { status },
  );
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => setAccessToken(null));
afterEach(() => vi.unstubAllGlobals());
it("does not restore an in-flight refresh token after logout", async () => {
  const pending = deferred();
  const fetcher = vi
    .fn()
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue(reply([]));
  vi.stubGlobal("fetch", fetcher);
  const refresh = refreshSession();
  const outcome = refresh.catch((error) => error);
  setAccessToken(null);
  pending.resolve(
    reply({ accessToken: "old-token", user: { id: "old-user" } }),
  );
  expect(await outcome).toMatchObject({ code: "SESSION_CHANGED" });
  await api("/providers");
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBeUndefined();
});
it("does not let an old failed refresh log out a newer login", async () => {
  const pending = deferred();
  const expired = vi.fn();
  window.addEventListener("session-expired", expired);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(null, 401))
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValue(reply([]));
  vi.stubGlobal("fetch", fetcher);
  const old = api("/addresses").catch((error) => error);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  setAccessToken("new-token");
  pending.resolve(reply(null, 401));
  await old;
  await api("/providers");
  expect(fetcher.mock.calls[2][1].headers.Authorization).toBe(
    "Bearer new-token",
  );
  expect(expired).not.toHaveBeenCalled();
  window.removeEventListener("session-expired", expired);
});
it("discards private responses from an earlier login", async () => {
  const pending = deferred();
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
  setAccessToken("first-token");
  const old = api("/addresses").catch((error) => error);
  setAccessToken("second-token");
  pending.resolve(reply([{ label: "First account private address" }]));
  expect(await old).toMatchObject({ code: "SESSION_CHANGED" });
});
it("shares one refresh between simultaneous expired-token requests", async () => {
  const pending = deferred();
  let expired = 0;
  const fetcher = vi.fn((url: string) =>
    url.endsWith("/auth/refresh")
      ? pending.promise
      : Promise.resolve(++expired <= 2 ? reply(null, 401) : reply([])),
  );
  vi.stubGlobal("fetch", fetcher);
  const a = api("/addresses"),
    b = api("/orders");
  await vi.waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([url]) => url.endsWith("/auth/refresh")),
    ).toHaveLength(1),
  );
  pending.resolve(
    reply({ accessToken: "rotated-token", user: { id: "same-user" } }),
  );
  await expect(Promise.all([a, b])).resolves.toEqual([[], []]);
});

it.each(["<html>Proxy error</html>", "null", "{}"])(
  "rejects a malformed success envelope: %s",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(body, { status: 200 })),
    );
    await expect(api("/addresses")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 502,
    });
  },
);

it("expires the local session instead of silently switching accounts when another tab changes the cookie", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(reply(null, 401))
    .mockResolvedValueOnce(
      reply({ accessToken: "account-b-token", user: { id: "account-b" } }),
    )
    .mockResolvedValue(reply([]));
  vi.stubGlobal("fetch", fetcher);
  setAccessToken("account-a-token", "account-a");
  await expect(api("/addresses")).rejects.toMatchObject({ status: 401 });
  await api("/providers");
  expect(fetcher.mock.calls[2][1].headers.Authorization).toBeUndefined();
});
