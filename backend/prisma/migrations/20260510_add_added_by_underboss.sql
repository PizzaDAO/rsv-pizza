-- Add addedByUnderboss boolean to Sponsor table
-- When true, contact info is hidden from event hosts (only visible to admin/underboss)
ALTER TABLE "Sponsor" ADD COLUMN IF NOT EXISTS "added_by_underboss" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark existing auto-created sponsors as underboss-added
UPDATE "Sponsor" SET "added_by_underboss" = true WHERE "notes" LIKE 'Auto-created from partner tag%';
