-- provola-92106: per-receipt "ineligible for reimbursement" flag.
-- Distinct from culatello-92104's `is_duplicate`: ineligible receipts are
-- legitimate purchases the host paid for, but they don't qualify under the
-- reimbursement policy (alcohol, tips, personal items). Visually treated
-- with amber tint + 135° diagonal stripes + INELIGIBLE pill (distinct
-- from duplicate's red 45° pattern). Same exclusion behavior as
-- `is_duplicate`: excluded from the reviewer modal's OCR sum, the by-city
-- `receiptUsdTotal`, the host PATCH `survivingOcrSum` recompute, and the
-- pizza-prices analytics aggregate.
--
-- Independent flags — both columns can be true on the same row, though the
-- UI prefers duplicate as the primary visual signal.
--
-- For per-LINE ineligibility, see the `ocrLineItems` jsonb column: each
-- entry now accepts an optional `ineligible?: boolean` field. No schema
-- change required there since the column is jsonb.
ALTER TABLE "payout_documents"
  ADD COLUMN IF NOT EXISTS "ineligible" boolean NOT NULL DEFAULT false;

-- Column-level SELECT grant (project convention — see CLAUDE.md "Common
-- Gotchas"). Without this, anon/authenticated queries that read the new
-- column would 403 against the column-level RLS grant.
GRANT SELECT ("ineligible") ON "payout_documents" TO anon, authenticated;
