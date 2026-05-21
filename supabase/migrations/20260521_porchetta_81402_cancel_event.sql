-- ============================================
-- porchetta-81402: Convert event deletion to soft-cancel
-- ============================================
-- Adds three columns to the `parties` table so hosts can cancel
-- (and reinstate) an event without destroying the row, guests,
-- or any child resources.
--
-- Backfill of previously hard-deleted parties is handled by the
-- companion script: backend/scripts/restore-host-cancellations.cjs
-- ============================================

ALTER TABLE parties
  ADD COLUMN cancelled_at        TIMESTAMPTZ,
  ADD COLUMN cancelled_by        TEXT,
  ADD COLUMN cancellation_reason TEXT;

-- Partial index — most queries care about "is this event cancelled" or
-- "find all currently-cancelled events", neither of which need to scan
-- the (much larger) set of live rows.
CREATE INDEX idx_parties_cancelled_at
  ON parties (cancelled_at)
  WHERE cancelled_at IS NOT NULL;

-- Additive grant only. The Feb 2026 security audit replaced the
-- table-level SELECT grant with column-level grants (to hide
-- `password`); new columns must be granted explicitly or the
-- frontend Supabase queries return `permission denied for table
-- parties` (42501).
GRANT SELECT (cancelled_at, cancelled_by, cancellation_reason)
  ON parties TO anon, authenticated;
