-- margherita-58471: T-4h event reminders

ALTER TABLE parties
  ADD COLUMN reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE;

GRANT SELECT (reminders_enabled) ON parties TO anon, authenticated;

ALTER TABLE guests
  ADD COLUMN reminders_unsubscribed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN reminder_sent_at TIMESTAMPTZ;

GRANT SELECT (reminders_unsubscribed, reminder_sent_at)
  ON guests TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_guests_reminder_pending
  ON guests (party_id)
  WHERE reminder_sent_at IS NULL
    AND reminders_unsubscribed = FALSE
    AND approved = TRUE
    AND email IS NOT NULL;
