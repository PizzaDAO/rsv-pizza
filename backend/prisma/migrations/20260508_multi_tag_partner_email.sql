-- Allow the same email to appear on multiple sponsor_user rows (one per tag)
-- Remove the unique constraint on email alone
ALTER TABLE sponsor_users DROP CONSTRAINT IF EXISTS sponsor_users_email_key;

-- Add composite unique constraint on (email, tag)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sponsor_users_email_tag_key'
  ) THEN
    ALTER TABLE sponsor_users ADD CONSTRAINT sponsor_users_email_tag_key UNIQUE (email, tag);
  END IF;
END $$;

-- Add index on email for fast lookups
CREATE INDEX IF NOT EXISTS idx_sponsor_users_email ON sponsor_users(email);
