-- culatello-92104: per-receipt "marked duplicate" flag for admin review.
-- Duplicate-flagged receipts are visually dimmed in the reviewer modal,
-- excluded from the receipt OCR sum, and ignored by the host PATCH
-- finalAmountUsd recompute path so admin edits propagate correctly. The
-- flag is reversible — admins can un-mark from the same toggle.
ALTER TABLE "payout_documents"
  ADD COLUMN IF NOT EXISTS "is_duplicate" boolean NOT NULL DEFAULT false;

-- Column-level SELECT grant (project convention — see CLAUDE.md "Common
-- Gotchas"). Without this, anon/authenticated queries that read the new
-- column would 403 against the column-level RLS grant.
GRANT SELECT ("is_duplicate") ON "payout_documents" TO anon, authenticated;
