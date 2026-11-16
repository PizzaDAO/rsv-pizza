-- claim-later-nft: one row per guest whose attendance NFT is minted by the backend after the
-- event (direct mint to a wallet on file, or a private claim link / logged-in claim to any
-- address). token_hash = sha256 hex of the claim token (the plaintext is only ever in the
-- emailed URL); null for direct mints. recipient_address is locked at the first mint attempt
-- so a retry can't redirect the NFT. Additive, new table only (no parties/guests columns, so
-- no column-grant or realtime change). NOT applied by the PR: apply to prod BEFORE merging
-- (backend/scripts/apply-nft-claims.cjs --apply).
-- RLS enabled with no policies + no anon/authenticated grants: backend only.
CREATE TABLE IF NOT EXISTS "nft_claims" (
  "guest_id"           UUID NOT NULL,
  "party_id"           UUID NOT NULL,
  "token_hash"         TEXT,
  "token_expires_at"   TIMESTAMPTZ,
  "status"             TEXT NOT NULL DEFAULT 'issued',
  "source"             TEXT NOT NULL,
  "recipient_address"  TEXT,
  "recipient_input"    TEXT,
  "previous_address"   TEXT,
  "attempts"           INTEGER NOT NULL DEFAULT 0,
  "last_error"         TEXT,
  "minting_started_at" TIMESTAMPTZ,
  "minted_at"          TIMESTAMPTZ,
  "tx_hash"            TEXT,
  "token_id"           INTEGER,
  "email_sent_at"      TIMESTAMPTZ,
  "email_resend_id"    TEXT,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "nft_claims_pkey" PRIMARY KEY ("guest_id"),
  CONSTRAINT "nft_claims_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guests"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "nft_claims_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "nft_claims_token_hash_key" ON "nft_claims" ("token_hash");
CREATE INDEX IF NOT EXISTS "nft_claims_party_id_idx" ON "nft_claims" ("party_id");
CREATE INDEX IF NOT EXISTS "nft_claims_status_minting_started_at_idx" ON "nft_claims" ("status", "minting_started_at");
CREATE INDEX IF NOT EXISTS "nft_claims_minted_at_idx" ON "nft_claims" ("minted_at");
ALTER TABLE "nft_claims" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "nft_claims" FROM anon;
REVOKE ALL ON "nft_claims" FROM authenticated;
