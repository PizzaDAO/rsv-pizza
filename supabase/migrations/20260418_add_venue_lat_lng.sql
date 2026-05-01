-- Add latitude/longitude columns to parties table for venue geocoding
ALTER TABLE parties ADD COLUMN latitude DOUBLE PRECISION;
ALTER TABLE parties ADD COLUMN longitude DOUBLE PRECISION;

-- Grant SELECT on new columns to anon and authenticated roles
-- (Required because column-level grants are in effect after Feb 2026 security audit)
GRANT SELECT (latitude, longitude) ON parties TO anon, authenticated;
