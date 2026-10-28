# Loop - household waste pickup

A complete local development application for mobile OTP sign-in, provider discovery, multiple pickup addresses, atomic slot reservations, sandbox payments, and private order history.

React + TypeScript + Vite - Express + TypeScript - Prisma - SQLite

Live full-stack demo: **https://hks-fullstack.vercel.app** · [API health](https://hks-fullstack-api-m007.onrender.com/api/health)

## Free full-stack deployment

The cloud profile uses Vercel for React, Render Free for Express, and Neon Postgres for persistent data. Each visitor enters as a separate demo guest with a server-signed JWT and a fictional starter address. Payments are simulated and verified by the backend. See [CLOUD_DEPLOYMENT.md](CLOUD_DEPLOYMENT.md) for setup and verification.

An optional browser-only GitHub Pages demo is still available through the manually triggered `.github/workflows/deploy.yml`. Its data resets on reload. See [DEPLOYMENT.md](DEPLOYMENT.md) for that alternative. Pushes to `main` run `.github/workflows/ci.yml`, which checks the local app and the Postgres profile independently.

## Quick start

Prerequisite: Node.js 22.12+ or Node.js 24, and npm. No paid service, Redis, Docker, or SMS account is needed.

Run these commands **from the repository root**:

```sh
npm install
npm run setup
npm run migrate
npm run seed
npm run dev
```

Open **http://localhost:5173**. API: **http://localhost:4000/api**.

`npm run setup` creates ignored backend/frontend `.env` files and generates independent random secrets. It never overwrites an existing environment file. Keep those secrets private.

To run in separate terminals:

```sh
npm run dev -w backend
npm run dev -w frontend
```

1. Enter a valid phone number, e.g. your own Indian mobile number with `+91`.
2. Read the random `[DEV OTP] +91... => <six-digit code>` code in the backend terminal.
3. Enter it within five minutes. There is no universal OTP.
4. Add an address. Demo coverage: Bengaluru **560001**, **560034**, **560038**; Mysuru **570001**. Coverage varies by provider.
5. Choose a provider, waste types, date, and time.
6. Continue to payment. The slot is held for ten minutes.
7. Click **Pay**, then **Simulate successful payment** or **Simulate failed payment**.
8. A successful verified payment produces **PROCESSING** in **My pickups**.

Seed reruns are additive/idempotent; they never clear bookings. Slots are generated for the next seven days in Asia/Kolkata. Run `npm run seed` again as the demo ages.

## Commands

| Task                                 | Command from root                            |
| ------------------------------------ | -------------------------------------------- |
| Install reproducibly after cloning   | `npm ci`                                     |
| Generate local environment           | `npm run setup`                              |
| Apply committed migrations           | `npm run migrate`                            |
| Generate Prisma client explicitly    | `npm run generate -w backend`                |
| Seed providers and future slots      | `npm run seed`                               |
| API development server               | `npm run dev -w backend`                     |
| React development server             | `npm run dev -w frontend`                    |
| API integration/security tests       | `npm test -w backend`                        |
| React component/flow tests           | `npm test -w frontend`                       |
| Both suites                          | `npm test`                                   |
| Browser acceptance test              | `npm run test:e2e`                           |
| TypeScript                           | `npm run typecheck`                          |
| ESLint                               | `npm run lint`                               |
| Format                               | `npm run format`                             |
| Build both applications              | `npm run build`                              |
| All regular quality checks           | `npm run check`                              |
| Start compiled API with local config | `npm start -w backend`                       |
| Preview frontend build               | `npm run preview -w frontend -- --port 5173` |
| Dependency advisories                | `npm audit`                                  |

The browser test uses installed Google Chrome by default. To use Edge: set `PLAYWRIGHT_CHANNEL=msedge`. Alternatively install a Playwright browser and adapt the channel setting. It starts isolated servers on 4001/5174, uses `e2e.db`, and records screenshots in ignored `test-results/`. API tests use a separate `test.db`; they never clear `dev.db`. Test fixtures reset only their dedicated test database.

## Architecture and directory tree

```text
.
+-- ARCHITECTURE.md
+-- README.md
+-- package.json / package-lock.json
+-- eslint.config.mjs
+-- playwright.config.ts
+-- scripts/
|   +-- setup.mjs
|   +-- e2e-server.mjs
+-- e2e/acceptance.spec.ts
+-- backend/
|   +-- .env.example
|   +-- prisma/
|   |   +-- schema.prisma
|   |   +-- migrations/
|   |   +-- seed.ts
|   |   +-- seed-data.ts
|   +-- src/
|   |   +-- config/          validated environment
|   |   +-- middleware/      JWT authentication
|   |   +-- otp/             delivery interface + console adapter
|   |   +-- payments/        gateway interface + mock/Razorpay adapters
|   |   +-- rateLimit/       store interface + memory implementation
|   |   +-- repositories/    Prisma + mandatory ownership lookups
|   |   +-- routes/          thin HTTP adapters
|   |   +-- security/        access and refresh token primitives
|   |   +-- services/        auth, addresses, providers, bookings, payments, cache
|   |   +-- jobs/            expiry transaction
|   |   +-- validators/      strict request schemas
|   |   +-- utils/           errors and cryptography
|   |   +-- app.ts
|   |   +-- server.ts
|   +-- tests/               API/security/concurrency acceptance tests
+-- frontend/
    +-- .env.example
    +-- src/
        +-- api/             fetch client + single-flight refresh
        +-- components/      shared accessible UI
        +-- features/
        |   +-- auth/
        |   +-- addresses/
        |   +-- providers/
        |   +-- bookings/
        |   +-- payments/
        |   +-- orders/
        +-- layouts/
        +-- routes/
        +-- schemas/
        +-- test/
        +-- types/
        +-- utils/
        +-- main.tsx
        +-- styles.css
```

The modular monolith keeps HTTP handling, business state transitions, ownership queries, and external adapters separate. React Query manages server state; React Hook Form and Zod handle forms. Access tokens stay in memory. React Router protects application pages.

## Database

All primary entity IDs are UUIDs. The committed schema includes normalized waste-type and service-area junction tables, foreign keys, unique references, and indexes.

| Entity                   | Purpose                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| User                     | Unique normalized phone and UUID identity                         |
| UserAddress              | Multiple owned pickup addresses                                   |
| OtpChallenge             | Keyed OTP hash, expiry, attempts, consumption timestamp           |
| RefreshToken             | SHA-256 token hash, family, expiry and revocation                 |
| ServiceProvider          | Description, integer paise price, active flag, demo rating        |
| ProviderWasteType        | Supported waste types                                             |
| ProviderServiceArea      | Supported city/postal-code pairs                                  |
| ProviderAvailabilitySlot | A single globally reservable provider interval                    |
| Booking                  | User ownership, request idempotency and historical snapshots      |
| BookingWasteType         | Selected waste types                                              |
| Payment                  | One durable payment record per booking, unique gateway references |
| WebhookEvent             | Idempotent processing ledger                                      |

Provider, price, address, waste types, and UTC slot timestamps are captured with the booking. Editing an address does not alter history. A referenced address cannot be deleted.

Ratings are clearly labelled demo placeholders. Prices are flat per pickup, in INR, stored as integer paise. Times are stored as UTC instants and displayed in **Asia/Kolkata**. Server date filters use Indian calendar-day boundaries.

## Authentication

- Phones normalize to E.164 using libphonenumber-js (India default).
- Cryptographically random six-digit OTPs are HMAC-SHA256 hashed with a separate secret. Expiry is five minutes; at most five verification attempts.
- Resends require 60 seconds, with at most five per phone/hour, plus IP limits.
- New challenges invalidate older ones. Successful verification atomically consumes the challenge.
- Access tokens are signed HS256 JWTs with fixed issuer/audience and 15-minute default lifetime.
- Refresh tokens are opaque 48-byte random values. Only hashes are stored.
- Refresh rotates atomically; replay of a revoked token revokes its family.
- The refresh cookie is HttpOnly, SameSite=Strict, and scoped to `/api/auth`. Local HTTP uses `secure:false`.
- Refresh/logout require a custom header and enforce origin checks. Client refresh is single-flight to avoid duplicate rotation within a tab.
- Logout revokes the refresh family and clears the cookie. Already-issued access tokens expire naturally within their short lifetime.

Every owned-resource lookup includes the authenticated user UUID. Request bodies cannot override user identity, amount, or state. Non-owned UUIDs return 404 without revealing existence.

## Slot concurrency and state transitions

A provider has **one capacity across all areas** during a time interval.

1. Validate owned address, current provider coverage, supported waste and server price.
2. In a SQLite transaction, conditionally update the selected slot where `status=AVAILABLE`, provider matches, and start is beyond the hold window.
3. Exactly one affected row is required; otherwise return **409 SLOT_NOT_AVAILABLE**.
4. Insert the booking and link the slot within the same transaction.
5. SQLite serializes writes; bounded retries handle transient transaction conflicts.
6. Per-user idempotency keys and payload hashes make retries return the original booking and reject changed payloads.

A database unique interval key alone is insufficient. The availability service checks `existing.startAt < new.endAt && existing.endAt > new.startAt` transactionally. SQLite insert/update triggers enforce the same invariant, including partial overlaps, even for direct scripts. Separate triggers validate slot state fields.

```text
AVAILABLE -> HELD -> BOOKED
              -> AVAILABLE on expiry, cancellation, or mock failure

PENDING_PAYMENT -> PAYMENT_PROCESSING -> PROCESSING
       -> EXPIRED / CANCELLED / PAYMENT_FAILED

CREATED -> PAID / FAILED / REFUND_REQUIRED
```

Cleanup runs every 30 seconds and during availability/booking operations. Expiry and release are transactional. A late payment cannot reclaim a released slot. It is recorded as **REFUND_REQUIRED** for operator handling.

## Payments

### Local mock (default)

No credentials or network access. The adapter generates an order and server-side captured-payment proof. The mock success endpoint goes through the same signature, captured-amount and transactional settlement logic. A failure releases the hold. There is no client-controlled price or unverified "paid" flag.

### Razorpay test mode

Edit `backend/.env`:

```dotenv
PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=rzp_test_your_key
RAZORPAY_KEY_SECRET=your_test_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
```

Restart the API. The application rejects any key ID that does not start with `rzp_test_`. The browser only receives the public key ID; secrets remain server-side.

- Create a gateway order using the booking's amount/currency.
- Open the official Razorpay Checkout script.
- Verify HMAC-SHA256 over the **stored** order ID and payment ID using timing-safe comparison.
- Fetch payment state from Razorpay and require captured status, matching order, currency, and amount.
- Atomically mark payment PAID, booking PROCESSING, and slot BOOKED.
- Configure automatic capture in your Razorpay test dashboard.
- Configure a test webhook to `POST /api/payments/webhook` for `payment.captured` and `payment.failed`. Razorpay needs a reachable HTTPS URL; local mock requires no tunnel.
- Validate the webhook signature against the raw body before parsing and deduplicate event IDs transactionally.
- Failed gateway attempts retain the hold for Checkout retries. Expiry eventually releases it.

Only one durable order-creation claim is allowed per booking. Network ambiguity leaves that claim pending instead of issuing another remote order. An operator must reconcile it by receipt; development users can let the hold expire. Late captures require refund review; automatic refunds are deliberately not implemented.

Integration references: [Razorpay Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/), [webhook validation](https://razorpay.com/docs/webhooks/validate-test/), [SQLite isolation](https://www.sqlite.org/isolation.html), [Prisma transactions](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions).

## REST API

Success: `{ "data": ... }`. Error: `{ "error": { "code", "message", "fields"?, "requestId" } }`.

All user/provider/booking/payment endpoints require `Authorization: Bearer <access token>`. Mutations accept only JSON. Unknown request fields are rejected by domain schemas.

| Method             | Path                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------- |
| POST               | /api/auth/request-otp - phone                                                          |
| POST               | /api/auth/verify-otp - phone, challengeId, code                                        |
| POST               | /api/auth/refresh - cookie + X-Requested-With: Loop                                    |
| POST               | /api/auth/logout - cookie + X-Requested-With: Loop                                     |
| GET                | /api/me                                                                                |
| GET, POST          | /api/addresses                                                                         |
| GET, PATCH, DELETE | /api/addresses/:id                                                                     |
| GET                | /api/providers?wasteType=&location=&date=&slot=morning\|afternoon                      |
| GET                | /api/providers/:id                                                                     |
| GET                | /api/providers/:id/availability                                                        |
| POST               | /api/bookings/hold - providerId, slotId, addressId, wasteTypes; Idempotency-Key header |
| GET                | /api/bookings, /api/bookings/:id                                                       |
| POST               | /api/bookings/:id/cancel                                                               |
| GET                | /api/orders, /api/orders/:id                                                           |
| POST               | /api/payments/create - bookingId                                                       |
| POST               | /api/payments/verify - bookingId and Razorpay proof fields                             |
| POST               | /api/payments/mock - bookingId, outcome: success\|failure                              |
| GET                | /api/payments/:id                                                                      |
| POST               | /api/payments/webhook - signed raw JSON                                                |
| GET                | /api/health                                                                            |

Address PATCH currently accepts the complete address form. Unused-address deletion returns 204.

## Security and operational boundaries

Implemented: strict Zod validation, React escaping, plain-text field validation, Helmet/CSP headers on the API, strict configured CORS, origin validation, body limits, secure errors without stack traces, JWT verification, hashed secrets, per-resource ownership, rate limits, parameterized Prisma queries, and structured redacted request logs. SQL migrations contain static triggers only; no user input is interpolated into SQL. No secrets are committed.

Provider metadata is cached for 30 seconds through a cache interface. Availability always comes from the database; claiming never trusts the cache. The rate limiter and cache use local memory and are not suitable as distributed coordination.

**This is a portfolio demo, not a real customer service.** `NODE_ENV=production` permits only the explicit public-demo profile with mock payments, Postgres, and an HTTPS frontend. Real customer production remains disabled.

Before real deployment:

- Implement real SMS delivery and remove console OTP logging.
- Review abuse prevention, phone verification limits and account recovery.
- Use HTTPS, Secure cookies, a secrets manager, trusted proxy configuration, and appropriate frontend CSP for Razorpay.
- Add distributed rate limiting/cache adapters for multiple instances and operational monitoring.
- Add gateway order reconciliation, refund execution, signed-event retention, payment support procedures, and carefully reviewed live-mode configuration.
- Add provider administration, dispatch/completion workflow, pickup support, and policy-driven cancellation/refunds.
- Add pagination beyond the current 100-item order/slot limits, retention cleanup, backups and restore tests.
- Evaluate a production database and capacity plan; the local SQLite write model deliberately favors correctness over throughput.
- Add revocable access sessions if immediate post-logout access-token invalidation is required.
- Review accessibility, dependency updates, privacy/retention, observability, and deployment hardening.
- Set appropriate OTP/webhook/session cleanup schedules. Current local tables retain their audit history.

No real SMS, live payment, delivery dispatch or automatic refund is performed. Razorpay test mode needs your own test credentials; local mock is fully usable without them. Fonts are bundled locally; the mock development flow requires no external browser requests.
