-- Add co_hosts field to parties table
-- Run this in Supabase SQL Editor

-- Add co_hosts column as JSONB array
ALTER TABLE parties ADD COLUMN IF NOT EXISTS co_hosts JSONB DEFAULT '[]'::jsonb;

-- Add a comment explaining the structure
COMMENT ON COLUMN parties.co_hosts IS 'Array of co-host objects with structure: [{"id": "uuid", "name": "string", "website": "url", "twitter": "username", "instagram": "username", "avatar_url": "url"}]';

-- Verify the column was added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'parties' AND column_name = 'co_hosts';
