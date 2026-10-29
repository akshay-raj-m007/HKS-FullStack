# Loop sanity and white-box review ? 29 October 2026

## Scope

Reviewed the existing modular monolith without redesigning it: OTP/session handling, verified-JWT ownership, address CRUD, provider filtering, atomic reservation and expiry, payment verification/webhooks, frontend navigation/state, Ask Loop, seed tools, SQLite/Postgres constraints, and build/deployment configuration. Tests run on isolated `test.db` and `e2e.db`; the local sample database and hosted data are not test targets.

## Findings fixed

| Severity | Finding and reproduction                                                                                                                                                                                                                                                                                            | Fix and files                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | An outstanding refresh could restore a token after logout; an older failed refresh could clear a newer login; an outstanding request could deliver the previous account's data. Three new tests failed on the original client. This is a browser lifecycle issue, not evidence of bypassing backend UUID ownership. | `frontend/src/api/client.ts` now binds requests and refreshes to a login generation, discards stale responses, and preserves single-flight refresh within a login. Regression tests: `frontend/src/test/client.test.ts`. `AuthContext.tsx` supplies the account identity so a different account returned through a cross-tab cookie change cannot silently replace the current session. |
| Medium   | Provider availability offered imminent slots that `holdBooking` necessarily rejected because its payment hold extended beyond pickup start. The new regression failed before the fix.                                                                                                                               | `backend/src/services/providers.ts` applies the same configurable hold cutoff as booking. Regression: `backend/tests/api.test.ts`.                                                                                                                                                                                                                                                      |
| Medium   | Invalid HTTP 200 JSON/envelopes could resolve as undefined data and break frontend consumers.                                                                                                                                                                                                                       | `frontend/src/api/client.ts` reports `INVALID_RESPONSE`; tests cover HTML, null and an empty object.                                                                                                                                                                                                                                                                                    |
| Medium   | Malformed Razorpay JSON/schema could escape as a syntax/Zod error, wrongly reported as invalid customer input.                                                                                                                                                                                                      | `backend/src/payments/razorpay.ts` reports a sanitized 502 `PAYMENT_GATEWAY_INVALID_RESPONSE`. Mocked transport regressions cover invalid JSON and incomplete order data.                                                                                                                                                                                                               |
| Medium   | `npm run check` failed with Windows EPERM when Prisma generation tried replacing the native engine loaded by the running dev API. Observed in the initial run.                                                                                                                                                      | `backend/scripts/test.mjs` reuses the generated client only when its schema exactly matches the local schema; missing/different schema still triggers generation. Tests remain isolated.                                                                                                                                                                                                |
| Medium   | A slower API startup let Playwright begin against Vite before the API was listening; observed `ECONNREFUSED` on the first OTP request.                                                                                                                                                                              | `scripts/e2e-server.mjs` now checks isolated API health before launching the frontend used as the readiness gate.                                                                                                                                                                                                                                                                       |

## White-box coverage

- Authentication: random hashed OTPs, attempts/expiry/resend limits, JWT verification, in-memory frontend access tokens, hashed refresh rotation/replay revocation, cookie flags and CSRF controls.
- Ownership: UUID scope on addresses, bookings, orders and payments; no client-provided identity accepted by private routes.
- Booking: server prices, all-category/coverage checks, conditional transactional slot claim, idempotency, one winner under concurrency, overlap and state constraints, hold expiry/cancellation.
- Payments: signature and captured amount/currency/order verification, atomic settlement, webhook deduplication, late capture/refund-required behavior without reclaiming another user's slot.
- Frontend: form validation, address CRUD, protected routes, Back/Forward navigation, stale async callbacks, checkout dismissal, timer/listener cleanup, responsive Ask Loop and normal booking handoff.
- Assistant: feature gate, bounded images/history/time/tool calls, user-bound confirmation, scoped MCP tools, strict model schemas, private-address minimization, fresh database availability and no assistant booking mutations.
- Data: additive local fixtures, separate account ownership, SQLite/Postgres constraint definitions and migration profiles.

## Verification results

- Eight local Playwright acceptance/navigation tests passed, including the real local API two-user workflow and desktop/mobile Ask Loop UI with controlled responses.
- One built static-demo Playwright test passed (subpath refresh, navigation and checkout without a backend), using a separate ignored output directory and installed Chrome.
- `npm run check` passed: repository lint, TypeScript checks, 88 backend tests, frontend tests, and backend/frontend production builds. After the final cross-tab guard, the frontend suite was rerun: **43 tests passed**, with scoped lint and a fresh frontend build/typecheck also passing.
- Final `npm run test:e2e` after the API-health startup fix: **8 passed (1.5 minutes)**. The first real API two-user acceptance flow passed; the earlier `ECONNREFUSED` failure did not recur.
- Final built static-demo smoke after the session changes: **1 passed**.
- `git diff --check` passed for the reviewed source changes. The existing Vite warning for a JavaScript chunk over 500 kB remains non-blocking.
- The isolated SQLite test database applied the existing migration profile with no pending migrations. No schema migration was needed for these fixes.
- Initial failing regression runs reproduced the session races and imminent-slot mismatch; these were not inferred only from a passing test suite.

## Limits

This is a local code and regression review, not a guarantee that every possible defect is absent. Live NVIDIA image accuracy, live Razorpay transport, production load/penetration testing, and hosted Vercel/Render/Neon operation are not exercised in this run. External adapters use controlled responses in automated tests. Postgres constraint/CI definitions were reviewed; a fresh Postgres runtime validation is not claimed. No deployment or production mutation is performed.

Known engineering limits remain: process-local rate limiting/cache, bounded 100-record listings, no automated refund operator workflow, and no real dispatch/SMS production operation. These are existing documented boundaries, not silently implemented architecture changes.

## Follow-up: phone login via Vite's printed URL

The earlier browser suite used `localhost`, missing the `127.0.0.1` URL Vite prints. A real browser reproduction against the local app returned HTTP 403 `ORIGIN_REJECTED` for `/api/auth/request-otp` from `http://127.0.0.1:5173`. `backend/src/security/origin.ts` and `backend/src/app.ts` now permit equivalent loopback hosts only in development, with the same scheme and port. Production remains an exact configured-origin match; remote hosts, different ports, schemes and malformed origins remain rejected. CORS and the request-origin guard share the policy.

Real local app verification passed on both numeric loopback and localhost: request OTP, verify the console OTP, reach providers, reload with refresh rotation, and sign out. Temporary accounts/challenges were removed. Permanent coverage is added in `backend/tests/origin.test.ts` and `e2e/acceptance.spec.ts`.

Follow-up verification: 99 backend tests passed; the new numeric-loopback phone-login browser regression passed; backend lint, TypeScript and build checks passed. Both real local hostnames were also verified end to end as described above.


Port follow-up: a second `npm run dev` started Vite on 5174 because the verified app was already using 5173. The backend correctly rejected the different origin port. `frontend/vite.config.ts` now sets `strictPort: true`, so duplicate startup reports the occupied port instead of advertising a non-working login URL.

## Follow-up: duplicate dev processes and missing console OTPs

An earlier background verification run still owned the frontend port and captured its API output in an ignored log. A second dev run failed to start Vite while leaving its API watcher running because the root concurrently command did not stop sibling services. This caused port conflicts and made OTP output difficult to locate. The local OTP provider sends no SMS.

`package.json` now launches `scripts/dev.mjs`. It probes the configured API host/port and frontend port 5173 before starting either service. Concurrently handles process-tree shutdown and stops the other service on either success or failure. Both services print into the invoking terminal. The Vite proxy follows the configured API host/port unless explicitly overridden.

Verified after removing only the duplicate project dev processes:

- A clean `npm run dev` started both services; the API reported Razorpay mode.
- Real browser phone/console-OTP login, refresh after reload, and sign-out passed on both `127.0.0.1:5173` and `localhost:5173`. Temporary verification accounts and challenges were removed.
- A second invocation rejected occupied ports 4000 and 5173 with exit code 1 before starting any services.
- Deliberately terminating the verification frontend caused concurrently to terminate the backend too. Ports 4000 and 5173 were free afterward.
- Repository lint, TypeScript checks, and backend/frontend builds passed. The existing frontend chunk-size warning remains. No database schema or migration changed.

The existing webhook proxy on port 4010 was preserved. Its public Cloudflare URL returned a DNS resolution failure during this follow-up, so public webhook reachability is not confirmed by this run. Start the app once in your own terminal to receive console OTPs there; no hidden dev server is intentionally left running.
