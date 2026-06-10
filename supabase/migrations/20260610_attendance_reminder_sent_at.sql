-- Track when the TG "submit estimated attendance" reminder is sent for a party/city.
-- Recorded when the TG attendance-reminder endpoint successfully sends at least one message.
ALTER TABLE parties ADD COLUMN IF NOT EXISTS attendance_reminder_sent_at timestamptz;
