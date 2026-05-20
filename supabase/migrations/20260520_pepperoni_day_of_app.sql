-- pepperoni-58341: Day-of event app
-- Adds wifi_info + parking_notes columns to parties (logistics surfacing on day-of dashboard)
-- and an announcements audit table for the day-of broadcast feature.

ALTER TABLE parties
  ADD COLUMN wifi_info     TEXT,
  ADD COLUMN parking_notes TEXT;

-- Column-level SELECT grants required since the Feb 2026 security audit
-- switched parties from table-level to column-level SELECT.
GRANT SELECT (wifi_info, parking_notes) ON parties TO anon, authenticated;

CREATE TABLE announcements (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  party_id        UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  sent_by         TEXT NOT NULL,
  channels        TEXT[] NOT NULL,
  subject         TEXT,
  body            TEXT NOT NULL,
  recipient_count INT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcements_party ON announcements(party_id, sent_at DESC);

-- RLS enabled with no policies => deny-all for anon/authenticated.
-- Service-role (backend) bypasses RLS, so the day-of announce endpoint can
-- insert + read freely while the table stays inaccessible to browser clients.
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
