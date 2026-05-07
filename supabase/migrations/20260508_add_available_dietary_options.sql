-- Add available_dietary_options column to parties table
-- Empty array means "show all defaults" (backward compatible)
ALTER TABLE parties
ADD COLUMN available_dietary_options text[] DEFAULT '{}';
