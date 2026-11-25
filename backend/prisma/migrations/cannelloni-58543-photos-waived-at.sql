-- cannelloni-58543: host can submit payout for review without required event
-- photos via an acknowledgment checkbox. Nullable timestamp recording that waiver.
ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "photos_waived_at" TIMESTAMPTZ;
