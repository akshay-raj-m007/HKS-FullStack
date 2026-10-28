-- SQLite has no exclusion constraints. These triggers protect interval overlap
-- even when maintenance scripts bypass the application availability service.
CREATE TRIGGER slot_interval_insert BEFORE INSERT ON "ProviderAvailabilitySlot"
BEGIN
 SELECT CASE WHEN NEW."endAt" <= NEW."startAt" THEN RAISE(ABORT, 'INVALID_SLOT_INTERVAL') END;
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM "ProviderAvailabilitySlot" s
  WHERE s."providerId" = NEW."providerId"
  AND s."startAt" < NEW."endAt" AND s."endAt" > NEW."startAt"
 ) THEN RAISE(ABORT, 'OVERLAPPING_SLOT') END;
END;
CREATE TRIGGER slot_interval_update BEFORE UPDATE OF "providerId","startAt","endAt" ON "ProviderAvailabilitySlot"
BEGIN
 SELECT CASE WHEN NEW."endAt" <= NEW."startAt" THEN RAISE(ABORT, 'INVALID_SLOT_INTERVAL') END;
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM "ProviderAvailabilitySlot" s
  WHERE s."providerId" = NEW."providerId" AND s."id" != NEW."id"
  AND s."startAt" < NEW."endAt" AND s."endAt" > NEW."startAt"
 ) THEN RAISE(ABORT, 'OVERLAPPING_SLOT') END;
END;
CREATE TRIGGER slot_state_insert BEFORE INSERT ON "ProviderAvailabilitySlot"
BEGIN
 SELECT CASE WHEN
  (NEW."status" = 'AVAILABLE' AND (NEW."heldByUserId" IS NOT NULL OR NEW."holdExpiresAt" IS NOT NULL OR NEW."activeBookingId" IS NOT NULL))
  OR (NEW."status" = 'HELD' AND (NEW."heldByUserId" IS NULL OR NEW."holdExpiresAt" IS NULL))
  OR (NEW."status" = 'BOOKED' AND (NEW."activeBookingId" IS NULL OR NEW."heldByUserId" IS NOT NULL OR NEW."holdExpiresAt" IS NOT NULL))
 THEN RAISE(ABORT, 'INVALID_SLOT_STATE') END;
END;
CREATE TRIGGER slot_state_update BEFORE UPDATE ON "ProviderAvailabilitySlot"
BEGIN
 SELECT CASE WHEN
  (NEW."status" = 'AVAILABLE' AND (NEW."heldByUserId" IS NOT NULL OR NEW."holdExpiresAt" IS NOT NULL OR NEW."activeBookingId" IS NOT NULL))
  OR (NEW."status" = 'HELD' AND (NEW."heldByUserId" IS NULL OR NEW."holdExpiresAt" IS NULL))
  OR (NEW."status" = 'BOOKED' AND (NEW."activeBookingId" IS NULL OR NEW."heldByUserId" IS NOT NULL OR NEW."holdExpiresAt" IS NOT NULL))
 THEN RAISE(ABORT, 'INVALID_SLOT_STATE') END;
END;
