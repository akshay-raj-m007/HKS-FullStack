# Vercel + Render Free + Neon

Repository: https://github.com/akshay-raj-m007/HKS-FullStack

Frontend: https://hks-fullstack.vercel.app

API health: https://hks-fullstack-api-m007.onrender.com/api/health

This profile runs the actual Express API against Neon Postgres. The Vercel frontend calls `/api`, which Vercel rewrites to the Render service. Refresh cookies therefore belong to the frontend origin. No database URL or signing secret is compiled into the frontend.

## Profiles

- Local: SQLite, console OTP and mock/Razorpay test payments, using the existing setup.
- Hosted: Postgres, `PUBLIC_DEMO_MODE=true`, mock payments, and a new isolated guest account per demo entry. All protected resources still require a verified JWT. Session restoration uses the hashed, rotating refresh cookie. Signing out and entering again creates a different guest; reloading keeps the current guest session.
- Optional Pages: browser-only simulation, manually dispatched workflow.

Hosted guest identifiers are synthetic (`demo:<UUID>`). The UI labels them as guests and provides fictional address details. No phone verification or real pickup is offered in this profile. Visitors should use fictional details. All hosted payments use the existing server-side mock signature/capture verification path.

## Neon setup

The specified project is `floral-fire-73297568`, organization `org-square-sea-63302824`, branch `production`. `neon.ts` declares only Postgres; existing JWT authentication remains in Express.

```powershell
npx neon@latest login
npx neon@latest init -y --no-agent-setup --org-id org-square-sea-63302824 --project-id floral-fire-73297568 --branch production --services postgres
npx neon@latest deploy
npm run neon:generate
npm run neon:migrate
npm run neon:seed
npm run build
npm run neon:verify
```

The `--no-agent-setup` retry avoids an optional GitHub Copilot plugin installation error encountered during the initial requested `init`. The Neon Codex/Postgres skills installed successfully and were consulted. `neon deploy` pulls `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` (direct), and `NEON_BRANCH` into ignored `.env.local`. `scripts/neon-run.mjs` loads those values and maps the direct URL to Prisma's `DIRECT_DATABASE_URL` without overwriting `backend/.env`.

Postgres migrations live in `backend/prisma/postgres/migrations`. They create the existing models and add `btree_gist`, an exclusion constraint rejecting overlapping provider intervals, and slot-state checks. No SQLite database is converted, deleted, or uploaded. Test migrations on a separate Neon branch first:

```powershell
npx neon@latest checkout hks-deployment-check --create
npm run neon:generate
npm run neon:migrate
npm run neon:seed
npm run neon:verify
npx neon@latest checkout production
```

The configured policy expires newly created non-default branches after seven days. `neon:verify` starts the actual app on a temporary local HTTP port against the selected Neon branch. It verifies guest JWTs, UUID isolation, a concurrent double-booking race, signature-verified mock payment, persisted payment/slot state, refresh rotation/replay rejection, and database overlap rejection. It removes only its own guest fixtures afterward. It never truncates shared tables.

For a persistent local server against the currently linked Neon branch after building:

```powershell
npm run neon:start
```

Before returning to SQLite development, run `npm run generate -w backend` to regenerate the SQLite client. `npm test -w backend` does this automatically and uses only `test.db`.

## Render

`render.yaml` describes a single Free web service named `hks-fullstack-api-m007`, in Ohio near the Neon US East database. It creates no paid datastore or disk.

- Repository: `https://github.com/akshay-raj-m007/HKS-FullStack`, branch `main`.
- Build: `npm ci --include=dev && npm run generate:postgres -w backend && npm run build -w backend`.
- Start: `npm run start:cloud -w backend`.
- Health: `/api/health`.

Required backend environment:

| Name                  | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| `NODE_ENV`            | `production`                                                       |
| `HOST`                | `0.0.0.0`                                                          |
| `PUBLIC_DEMO_MODE`    | `true`                                                             |
| `PAYMENT_PROVIDER`    | `mock`                                                             |
| `DATABASE_URL`        | Neon pooled URL, kept secret                                       |
| `DIRECT_DATABASE_URL` | Neon direct URL, kept secret                                       |
| `JWT_ACCESS_SECRET`   | Random server-only secret, at least 32 characters                  |
| `OTP_HASH_SECRET`     | Separate random server-only secret, at least 32 characters         |
| `FRONTEND_URL`        | The exact production Vercel HTTPS origin, without a trailing slash |

Render supplies `PORT`. The cloud start command deploys migrations and additively seeds catalog/future availability before starting the server. Existing bookings are preserved. Run the seed again as the demo ages, or redeploy to refresh the next seven days of slots.

Render Free sleeps when idle, so the first API request may take around a minute. Data persists in Neon across Render restarts. The app still uses single-instance in-memory rate limiting and mock gateway state; this is a portfolio deployment.

## Vercel

Project: `hks-fullstack`. **Root Directory: `frontend`**, with source files outside that directory included for this npm workspace.

`frontend/vercel.json` configures:

- Install: `cd .. && npm ci`.
- Build: `cd .. && npm run build:vercel`.
- Output: `dist`.
- API proxy to the Render service, before the React route fallback.

`build:vercel` compiles the public hosted-demo frontend using `/api` and BrowserRouter. It disables the browser-only demo adapter. No frontend secrets are required. If the Render hostname changes, update the rewrite destination in `frontend/vercel.json` and redeploy.

Connect `akshay-raj-m007/HKS-FullStack` to the Vercel project with its GitHub integration for frontend deploys on `main`. `.github/workflows/ci.yml` runs lint, TypeScript, the existing suites/builds, and isolated Postgres service tests on pushes and pull requests. After those jobs pass on `main`, it triggers Render's deploy hook with the exact verified commit SHA. Native platform builds also compile the apps before publishing them.

The Render service was created from its public repository URL. Render cannot automatically deploy that source without a Git-provider connection, so the Actions deploy-hook job handles it. Copy the secret Deploy Hook URL from the Render service's Settings into the GitHub repository Actions secret **`RENDER_DEPLOY_HOOK`**. Keep the URL private; it is not a frontend variable. The Render CLI/API used during setup did not expose this secret URL. The deployment job fails with a clear message until the secret is set.

Vercel also requires a GitHub Login Connection on your Vercel account before `vercel git connect` can enable its native Git integration. CLI production deployment works independently of that connection.

To repeat the real public browser checks locally:

```powershell
npm run cloud:verify
```

This opens Chrome headlessly against the production Vercel URL, verifies secure same-origin cookies and refresh rotation, books/pays for a sample pickup, reloads it to prove persistence, checks a second guest receives 404 for that pickup, and signs out. It creates fictional guest records and a sample pickup in the hosted demo. The screenshot is saved to ignored `test-results/cloud-demo.png`.

## Manual sanity check

1. Open the Vercel production URL and click **Open interactive demo**. On an idle Render service, allow time for startup.
2. Confirm the fictional Home address is present.
3. Choose GreenCycle Services, Home, Paper, and an available future slot.
4. Continue to payment, click Pay, and simulate successful payment.
5. Confirm the pickup is PROCESSING, then reload and confirm it remains in My pickups.
6. Try another booking with a failed payment or cancel an unpaid reservation.
7. Open an incognito session and enter the demo. Its addresses/bookings belong to a different guest.
8. Sign out and confirm protected routes return to the demo entry page.

No real SMS, money movement, pickup dispatch, or verified customer signup occurs. The hosted profile exercises actual API/database behavior with synthetic guests.

## Verified during setup

`npm run build` passed for both workspaces. The backend suite passed 33 tests and the frontend suite passed 25 tests. The Postgres verifier passed first on `hks-deployment-check`, then on `production`, with this output:

```text
PASS: server started, Neon health query, separate JWT guest identities
PASS: concurrent reservations yield one winner; other guest cannot access booking
PASS: mock signature verification and paid booking persisted in Neon
PASS: refresh rotation and replay rejection
PASS: database rejects partially overlapping provider slots
Verification guest fixtures cleaned up.
```

The public `npm run cloud:verify` browser run also passed secure cookie/refresh behavior, persistent checkout after reload, another guest's 404 response, sign-out, and absence of browser exceptions. The initial Vercel Linux build failed on missing optional Rollup binaries from the Windows-generated lockfile; pinned optional Linux Rollup/esbuild packages fixed the deployment. The initial four-worker frontend test run hit a Windows worker-start timeout; using one worker passed all tests. These fixes are committed.
