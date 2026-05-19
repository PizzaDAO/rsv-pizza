-- mushroom-48468: enforce case-insensitive uniqueness on User.email.
--
-- IMPORTANT: this migration MUST be applied AFTER the backend deploy that
-- lowercases on read/write, AND AFTER the dedup backfill in
-- 20260518_mushroom_48468_dedup_users.sql. Applying it earlier would fail
-- on the existing duplicate-casing rows.

-- 1. Drop the old case-sensitive unique constraint.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_key";

-- 2. Add a functional unique index on lower(email).
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_lower_unique"
  ON "User" (lower(email));

-- 3. CHECK constraint: forbid any future row whose email isn't already lowercase.
-- Belt-and-suspenders with the app-level normalizeEmail() helper.
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_is_lowercase"
  CHECK (email = lower(email)) NOT VALID;

-- Validate it separately so we can investigate stragglers if any slip past dedup.
ALTER TABLE "User" VALIDATE CONSTRAINT "User_email_is_lowercase";
