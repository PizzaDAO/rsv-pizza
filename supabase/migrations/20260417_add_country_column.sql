ALTER TABLE parties ADD COLUMN country TEXT;

UPDATE parties SET country = 'Canada' WHERE region = 'canada' AND country IS NULL;
UPDATE parties SET country = 'United States' WHERE region = 'usa' AND country IS NULL;
UPDATE parties SET country = 'Mexico' WHERE region = 'central-america' AND country IS NULL;
UPDATE parties SET country = 'India' WHERE region = 'india' AND country IS NULL;
UPDATE parties SET country = 'China' WHERE region = 'china' AND country IS NULL;
UPDATE parties SET country = 'Australia' WHERE region = 'oceania' AND country IS NULL;

GRANT SELECT (country) ON parties TO anon, authenticated;
