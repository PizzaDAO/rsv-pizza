-- Add external event link columns to parties table
ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS meetup_url TEXT,
  ADD COLUMN IF NOT EXISTS eventbrite_url TEXT,
  ADD COLUMN IF NOT EXISTS external_links JSONB DEFAULT '[]';

-- Column-level SELECT grants (required because project uses column-level grants)
GRANT SELECT (meetup_url, eventbrite_url, external_links) ON parties TO anon, authenticated;
