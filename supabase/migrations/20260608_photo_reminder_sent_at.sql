-- Track when photo reminders are sent for a party/city.
-- Recorded when the TG photo-reminder endpoint successfully sends at least one message.

ALTER TABLE parties ADD COLUMN IF NOT EXISTS photo_reminder_sent_at timestamptz;
