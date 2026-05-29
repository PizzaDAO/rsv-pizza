-- caciotta-92104: preserve the original user-supplied wallet input
-- alongside the canonical resolved 0x address.
--
-- payout_wallet_address holds the on-chain 0x destination (what
-- viem.sendTransaction sees). payout_wallet_input holds whatever the user
-- originally typed -- usually identical to the address, but for ENS-name
-- payouts it preserves the human-readable name (e.g. 'ariutokintumi.eth')
-- so the admin UI can display "ariutokintumi.eth -> 0xa1b2..." instead of
-- silently losing the ENS string at write time. Nullable for backward-compat
-- with historical rows where we never captured the input.
--
-- Applied to prod manually via pg before this migration was committed; the
-- file exists so a fresh `prisma migrate deploy` doesn't try to re-apply.

ALTER TABLE "payouts" ADD COLUMN IF NOT EXISTS "payout_wallet_input" TEXT;

-- caciotta-92104: column-level SELECT grants. The repo's security audit
-- switched to column-level grants for new payout columns; mirror the
-- existing payout_wallet_address grants.
GRANT SELECT ("payout_wallet_input") ON "payouts" TO anon, authenticated;
