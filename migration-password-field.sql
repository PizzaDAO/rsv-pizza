-- Add password field to parties table
-- Password is optional and used to gate RSVP page access
ALTER TABLE parties ADD COLUMN IF NOT EXISTS password TEXT NULL;
