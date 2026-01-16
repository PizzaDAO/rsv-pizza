-- Add code authentication fields to MagicLink table
ALTER TABLE "MagicLink" ADD COLUMN IF NOT EXISTS code TEXT UNIQUE;
ALTER TABLE "MagicLink" ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0;
ALTER TABLE "MagicLink" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);

-- Create index for faster code lookups
CREATE INDEX IF NOT EXISTS "MagicLink_code_idx" ON "MagicLink"(code);
