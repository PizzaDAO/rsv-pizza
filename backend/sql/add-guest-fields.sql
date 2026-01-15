-- Add new fields to guests table for enhanced RSVP
-- Run this in Supabase SQL Editor

-- Add email field
ALTER TABLE guests ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- Add ethereum_address field
ALTER TABLE guests ADD COLUMN IF NOT EXISTS ethereum_address VARCHAR(42);

-- Add roles field (array of strings for "What do you do?")
ALTER TABLE guests ADD COLUMN IF NOT EXISTS roles TEXT[] DEFAULT '{}';

-- Add mailing_list_opt_in field
ALTER TABLE guests ADD COLUMN IF NOT EXISTS mailing_list_opt_in BOOLEAN DEFAULT false;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email);
CREATE INDEX IF NOT EXISTS idx_guests_ethereum_address ON guests(ethereum_address);

-- Verify the columns were added
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'guests'
  AND column_name IN ('email', 'ethereum_address', 'roles', 'mailing_list_opt_in')
ORDER BY ordinal_position;
