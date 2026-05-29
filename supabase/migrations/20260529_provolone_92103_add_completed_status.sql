-- provolone-92103: add 'completed' to payout status check.
--
-- Snax wants Mark-Party-Paid's "close out the pending claims" mode to flip
-- rows to status='completed' instead of 'withdrawn'. Semantically:
--   - 'withdrawn' = host self-soft-deleted (ravioli-82931); claim invalid or
--     duplicate; org's payment obligation is unresolved.
--   - 'completed' = org closed out the city; the host was paid (possibly less
--     than the claim amount); this row's payment obligation is fulfilled.
--
-- Both are terminal states but 'completed' is the proper signal for "we paid,
-- you're done" while 'withdrawn' remains for "this claim was thrown out."
--
-- 'completed' is treated like 'paid' for cap math in assertWithinPartyCap
-- (counts toward usedUsd) but is rendered separately on the admin UI.
--
-- Existing 'withdrawn' rows are NOT migrated to 'completed' — they're still
-- valid withdrawals.
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
  CHECK (status IN ('pending','approved','rejected','paid','failed','withdrawn','completed'));
