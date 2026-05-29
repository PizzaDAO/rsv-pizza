-- mortadella-92103: per-receipt original-amount + locked exchange-rate columns.
--
-- The existing `ocr_amount` column on `payout_documents` is USD (Decimal(12,2)).
-- The original receipt amount in the source currency was previously only
-- preserved on the parent `payouts` row (as the FIRST receipt's headline FX),
-- or buried inside `ocr_raw` JSONB. That made forensics + per-receipt FX
-- re-runs impossible. We now persist the original amount/currency/rate on
-- every receipt document.
--
-- All three columns are NULL-able and default NULL — historical rows simply
-- have no FX detail. Auto-fill on new POST/PATCH writes is wired up in the
-- TypeScript routes.

ALTER TABLE "payout_documents"
  ADD COLUMN "original_amount"   NUMERIC(14, 4) NULL,
  ADD COLUMN "original_currency" CHAR(3)        NULL,
  ADD COLUMN "exchange_rate"     NUMERIC(18, 8) NULL;

-- Grant the column-level SELECT so the public-read code path (which uses
-- `safeColumns`-style narrow grants) doesn't 403 on these new fields. The
-- payouts/receipts API is auth-gated and uses the Prisma client (service role
-- / shared connection), but mirroring the existing grant pattern keeps the
-- schema consistent for any future anon-readable views.
GRANT SELECT ("original_amount", "original_currency", "exchange_rate")
  ON "payout_documents"
  TO anon, authenticated;
