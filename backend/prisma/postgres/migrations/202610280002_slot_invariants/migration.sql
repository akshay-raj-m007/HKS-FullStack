-- Postgres enforces the same interval/state invariants as the local SQLite
-- triggers. The exclusion constraint also handles concurrent inserts.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "ProviderAvailabilitySlot"
  ADD CONSTRAINT "slot_positive_interval" CHECK ("endAt" > "startAt"),
  ADD CONSTRAINT "slot_no_overlap" EXCLUDE USING gist (
    "providerId" WITH =,
    tsrange("startAt", "endAt", '[)') WITH &&
  ),
  ADD CONSTRAINT "slot_valid_state" CHECK (
    ("status" = 'AVAILABLE' AND "heldByUserId" IS NULL AND "holdExpiresAt" IS NULL AND "activeBookingId" IS NULL)
    OR ("status" = 'HELD' AND "heldByUserId" IS NOT NULL AND "holdExpiresAt" IS NOT NULL)
    OR ("status" = 'BOOKED' AND "activeBookingId" IS NOT NULL AND "heldByUserId" IS NULL AND "holdExpiresAt" IS NULL)
  );
