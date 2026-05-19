-- bounce-rate-heuristic: add email-status tracking columns to guests so the
-- Resend webhook handler can record bounces / suppressions / complaints and the
-- fake-detection scorer can fire `high_bounce_rate` on events with too many
-- bad addresses.
--
-- Applied to prod 2026-05-18 via Supabase Management API (apply_migration name:
-- add_guest_email_status_columns).
ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS email_status text,
  ADD COLUMN IF NOT EXISTS email_status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_resend_id text;

CREATE INDEX IF NOT EXISTS idx_guests_party_email_status ON guests(party_id, email_status);
CREATE INDEX IF NOT EXISTS idx_guests_email_resend_id ON guests(email_resend_id);

-- Column-level SELECT grants — the Feb 2026 security audit switched the parties
-- table to column-level grants; we follow the same pattern on guests so future
-- audits don't have to retrofit.
GRANT SELECT (email_status, email_status_updated_at, email_resend_id)
  ON guests TO anon, authenticated;
