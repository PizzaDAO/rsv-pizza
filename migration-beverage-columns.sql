-- Migration: Add beverage preference columns
-- This adds support for beverage ordering feature

-- Add available_beverages to parties table
ALTER TABLE parties
ADD COLUMN IF NOT EXISTS available_beverages text[] DEFAULT '{}';

-- Add beverage preferences to guests table
ALTER TABLE guests
ADD COLUMN IF NOT EXISTS liked_beverages text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS disliked_beverages text[] DEFAULT '{}';

-- Add default beverage preferences to users table (if it exists)
-- Note: Run this only if you have a users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS default_liked_beverages text[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS default_disliked_beverages text[] DEFAULT '{}';

-- Verify the changes
SELECT 'parties' as table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'parties' AND column_name = 'available_beverages'
UNION ALL
SELECT 'guests' as table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'guests' AND column_name IN ('liked_beverages', 'disliked_beverages')
UNION ALL
SELECT 'users' as table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name = 'users' AND column_name IN ('default_liked_beverages', 'default_disliked_beverages');
