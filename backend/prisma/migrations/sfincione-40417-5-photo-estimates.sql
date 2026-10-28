SET lock_timeout = '5s';
-- Photo pass: a size SUGGESTION read from the party's pizza photos. Never feeds
-- diameter_cm / area_cm2 (so never the index); a reviewer accepts it in the queue.
ALTER TABLE pizza_line_items ADD COLUMN IF NOT EXISTS photo_estimate jsonb;

CREATE TABLE IF NOT EXISTS pizza_photo_pass (
  party_id      uuid PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
  pass_at       timestamptz,
  attempts      int NOT NULL DEFAULT 0,
  last_error_at timestamptz,
  photo_urls    jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pizza_photo_pass ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pizza_photo_pass FROM anon, authenticated;
