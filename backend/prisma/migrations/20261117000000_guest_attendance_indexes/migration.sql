-- guest-attendance: partial expression indexes for POST /api/service/guest-attendance
-- (lib/guestAttendance.ts). The endpoint matches checked-in guests by sha256(lower(btrim(email)))
-- and by lower(ethereum_address); without these, each lookup scans every checked-in guest row.
-- The query expressions in lib/guestAttendance.ts MUST stay textually identical to these.
-- Additive, idempotent, no table rewrite, no new columns (Prisma schema unchanged).
--
-- convert_to() is only STABLE, so it cannot appear in an index expression directly. The hash is
-- wrapped in an IMMUTABLE SQL function (safe: the database encoding is UTF8 and the body only
-- calls pure functions). EXECUTE is revoked from everyone but the owner/superusers: the backend
-- connects as an owner role, anon/authenticated never need it.
--
-- NOTE: Prisma wraps migrations in a single transaction, so this file uses the plain
-- non-CONCURRENTLY form. In prod apply the CONCURRENTLY variant (create the function first, then
-- each CREATE INDEX on its own, outside a transaction block) to avoid a write lock on `guests`:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "guests_checked_in_email_sha256_idx"
--     ON "guests" (public.guest_email_sha256("email")) WHERE "checked_in_at" IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "guests_checked_in_wallet_lower_idx"
--     ON "guests" (lower("ethereum_address")) WHERE "checked_in_at" IS NOT NULL;
CREATE OR REPLACE FUNCTION public.guest_email_sha256(email text) RETURNS text
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(email)), 'UTF8')), 'hex') $$;
REVOKE ALL ON FUNCTION public.guest_email_sha256(text) FROM PUBLIC;

CREATE INDEX IF NOT EXISTS "guests_checked_in_email_sha256_idx"
  ON "guests" (public.guest_email_sha256("email"))
  WHERE "checked_in_at" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "guests_checked_in_wallet_lower_idx"
  ON "guests" (lower("ethereum_address"))
  WHERE "checked_in_at" IS NOT NULL;
