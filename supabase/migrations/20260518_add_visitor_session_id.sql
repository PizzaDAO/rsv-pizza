-- romana-30802: Add visitor_session_id column to guests for cookie-based
-- duplicate-RSVP detection. Cookie is set on RSVP page first mount and
-- repeats indicate same-browser padding.
--
-- Column is nullable — legacy rows stay NULL (intentional, no backfill).
-- Partial index excludes nulls to keep it small.
--
-- No anon/authenticated SELECT grant — admin/scorer only.

ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS visitor_session_id TEXT;

CREATE INDEX IF NOT EXISTS guests_visitor_session_id_idx
  ON guests(visitor_session_id)
  WHERE visitor_session_id IS NOT NULL;
