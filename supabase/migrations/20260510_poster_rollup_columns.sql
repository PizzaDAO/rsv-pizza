ALTER TABLE parties ADD COLUMN IF NOT EXISTS poster_image_url TEXT NULL;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS poster_generated_at TIMESTAMPTZ NULL;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS rollup_image_url TEXT NULL;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS rollup_generated_at TIMESTAMPTZ NULL;

-- Grant SELECT on new columns (table uses column-level grants)
GRANT SELECT (poster_image_url, poster_generated_at, rollup_image_url, rollup_generated_at)
  ON parties TO anon, authenticated;
