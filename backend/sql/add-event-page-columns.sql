-- Add missing columns to parties table for event page features
-- Run this in Supabase SQL Editor

-- Add password column (if not exists)
ALTER TABLE parties ADD COLUMN IF NOT EXISTS password TEXT NULL;

-- Add event_image_url column (if not exists)
ALTER TABLE parties ADD COLUMN IF NOT EXISTS event_image_url TEXT NULL;

-- Add description column (if not exists)
ALTER TABLE parties ADD COLUMN IF NOT EXISTS description TEXT NULL;

-- Add custom_url column (if not exists)
ALTER TABLE parties ADD COLUMN IF NOT EXISTS custom_url TEXT UNIQUE NULL;

-- Add duration column (if not exists)
ALTER TABLE parties ADD COLUMN IF NOT EXISTS duration FLOAT NULL;

-- Create index on custom_url for faster lookups
CREATE INDEX IF NOT EXISTS idx_parties_custom_url ON parties(custom_url);

-- Verify columns were added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'parties'
  AND column_name IN ('password', 'event_image_url', 'description', 'custom_url', 'duration')
ORDER BY column_name;
