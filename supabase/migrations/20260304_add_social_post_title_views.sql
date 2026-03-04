-- Add title and views columns to social_posts table
ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS views INTEGER;
