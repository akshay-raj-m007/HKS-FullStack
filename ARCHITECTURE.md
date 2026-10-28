# Architecture and implementation plan

## Hosted portfolio profile

The same React → Express → services → Prisma layers also support a hosted profile: Vercel serves the frontend and proxies `/api` to Render; Neon provides Postgres. Local SQLite and its migrations remain available for development. The Postgres schema is in `backend/prisma/postgres/`, with database exclusion/check constraints replacing the SQLite slot triggers. Runtime transactions use Serializable isolation with bounded retries. Availability is always claimed in the database.

Hosted operation is explicitly a public demo: a visitor creates a fresh server-owned guest UUID and receives a signed JWT and hashed, rotating refresh token. Guest accounts have synthetic identifiers and fictional starter addresses. Real phone OTP routes are disabled in this profile and payments remain server-verified mock payments. Production cookies are Secure, HttpOnly, SameSite=Strict; the Vercel API proxy keeps the browser session on one origin. The backend accepts its configured HTTPS frontend origin. This profile does not enable real customer or live-payment operation.

Build a modular monolith: React/TypeScript/Vite → Express REST API → domain services → Prisma → SQLite. Development is entirely local with random console OTPs and an explicit mock payment gateway; Razorpay is restricted to test keys.

## Assumptions

- India is the initial service region. Phone numbers normalize to E.164; the application displays timestamps in Asia/Kolkata and stores UTC instants.
- Prices are integer paise in INR, fixed per provider pickup. A booking may contain multiple supported waste types.
- Holds last ten minutes. One provider has one pickup capacity across all service areas at any instant.
- Provider administration is a server-side service/seed operation, not a public endpoint.

## Entities

User, UserAddress, OtpChallenge, RefreshToken, ServiceProvider, ProviderWasteType, ProviderServiceArea, ProviderAvailabilitySlot, Booking, BookingWasteType, Payment, and WebhookEvent use UUID primary keys. Booking records preserve provider, address, price, and slot snapshots.

## Security-sensitive flows

- OTPs: cryptographic generation, keyed hashes, five-minute expiry, bounded attempts and resends.
- Sessions: short JWT access tokens in browser memory, opaque hashed refresh tokens in HttpOnly cookies, atomic rotation, replay revocation, origin checks.
- Ownership: authenticated UUID is mandatory in all user-resource repository queries.
- Booking: a conditional AVAILABLE → HELD update inside a transaction is the reservation authority. Database triggers reject overlapping provider time ranges.
- Payments: server-calculated amount, unique booking/payment references, HMAC verification and captured-payment checks. Signed raw-body webhooks deduplicate transactionally.

## State machines

Slot: AVAILABLE → HELD → BOOKED; an expired, cancelled, or failed hold returns to AVAILABLE.

Booking: PENDING_PAYMENT → PAYMENT_PROCESSING → PROCESSING. Pending states may become EXPIRED, CANCELLED, or PAYMENT_FAILED. PROCESSING is reserved for verified payment.

Payment: CREATED → PAID or FAILED. Late captured payments become REFUND_REQUIRED without reclaiming a released slot.

## Delivery sequence

1. Project configuration, schema, migrations, seed data.
2. Authentication, validation, ownership repositories, security middleware.
3. Provider discovery, addresses, atomic reservations, hold expiry.
4. Mock and Razorpay test payment adapters, verification, webhooks.
5. Responsive React application and protected routes.
6. API/security/concurrency and frontend tests; install, migrate, seed, lint, typecheck, build, and verify the acceptance flow.
