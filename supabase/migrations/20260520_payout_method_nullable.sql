-- arugula-38633 (v3 follow-up): make payouts.payout_method optional.
--
-- Hosts can now submit a payout with just an amount — payment method +
-- receipts no longer gate submission. The DB CHECK that constrains the
-- value set (mercury_card | wire | usdc_base) is preserved and continues
-- to enforce the enumeration when a value IS provided. Postgres CHECKs
-- treat NULL as "unknown" (passes), so this is the minimal change needed.
--
-- Rollback (if ever required): UPDATE payouts SET payout_method='wire'
-- WHERE payout_method IS NULL; ALTER TABLE payouts ALTER COLUMN
-- payout_method SET NOT NULL;

ALTER TABLE payouts ALTER COLUMN payout_method DROP NOT NULL;
