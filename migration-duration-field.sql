-- Add duration field to parties table
-- Duration is stored as Float (decimal hours: 0.5, 1, 1.5, 2, etc.)
ALTER TABLE parties ADD COLUMN IF NOT EXISTS duration FLOAT NULL;
