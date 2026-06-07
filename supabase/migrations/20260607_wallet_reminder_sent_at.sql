-- Track when wallet reminders are sent for a party/city.
-- Recorded when the TG wallet-reminder endpoint successfully sends at least one message.

ALTER TABLE parties ADD COLUMN IF NOT EXISTS wallet_reminder_sent_at timestamptz;
