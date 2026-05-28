-- ravioli-82931: add 'withdrawn' to payout status check.
-- Soft-delete host withdrawals so linked payout_documents (receipts) are
-- preserved and remain visible in the host's receipts library. Withdrawn rows
-- are excluded from the host's active payouts list and from the per-party cap
-- sum (assertWithinPartyCap only sums 'paid'|'pending'|'approved').
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
  CHECK (status IN ('pending','approved','rejected','paid','failed','withdrawn'));
