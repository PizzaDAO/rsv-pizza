-- Add event image URL, description, and custom URL fields to parties table
-- These fields allow hosts to add visual and textual context to their events
-- and provide custom URL slugs for event pages
ALTER TABLE parties ADD COLUMN IF NOT EXISTS event_image_url TEXT NULL;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS description TEXT NULL;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS custom_url TEXT UNIQUE NULL;
