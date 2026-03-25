-- Add intake form fields to sponsors table
-- NOTE: These columns have ALREADY been applied to production DB.
-- This migration file exists for reference/documentation only.

ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS intake_token TEXT UNIQUE;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS intake_submitted_at TIMESTAMPTZ;
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS sponsor_message TEXT;
