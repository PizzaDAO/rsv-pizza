-- Add place_id column to parties for Google Maps "query_place_id" deep linking
ALTER TABLE parties ADD COLUMN place_id text;

-- Grant SELECT on new column to anon and authenticated roles
-- (Required because column-level grants are in effect after Feb 2026 security audit)
GRANT SELECT (place_id) ON parties TO anon, authenticated;
