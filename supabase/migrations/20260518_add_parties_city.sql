-- Adds parties.city column for first-class city storage
-- Applied to prod via Supabase Management API on 2026-05-18 prior to merge
ALTER TABLE parties ADD COLUMN IF NOT EXISTS city TEXT;
GRANT SELECT (city) ON parties TO anon, authenticated;
CREATE INDEX IF NOT EXISTS idx_parties_city_lower ON parties (lower(city));
