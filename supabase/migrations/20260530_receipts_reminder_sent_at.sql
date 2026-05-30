-- Track when receipts reminders are sent for a party/city.
-- Recorded when the TG reminder endpoint successfully sends at least one message.

ALTER TABLE parties ADD COLUMN IF NOT EXISTS receipts_reminder_sent_at timestamptz;
