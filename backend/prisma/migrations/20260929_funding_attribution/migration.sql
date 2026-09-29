-- White-label Phase 4: funding attribution. Additive columns only, no behavior
-- change. payouts records which source funded each send + a sender snapshot;
-- event_series carries the wallet a series intends to reimburse from (config;
-- actual send routing + custody land in Phase 5). Existing payout rows stay NULL
-- (we didn't record attribution before this).
ALTER TABLE "payouts" ADD COLUMN "funding_source_id" TEXT;
ALTER TABLE "payouts" ADD COLUMN "funding_wallet_address" TEXT;
ALTER TABLE "event_series" ADD COLUMN "funding_wallet_address" TEXT;
