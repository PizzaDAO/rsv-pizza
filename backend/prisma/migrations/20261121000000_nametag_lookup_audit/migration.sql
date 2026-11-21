-- marinara-32633: audit + rate-limit counter for member lookups for printed name tags.
-- Backend-only table (no anon/authenticated access). Holds no emails, hashes or names. Additive.
-- Apply to prod BEFORE merging the schema change (see CLAUDE.md).
CREATE TABLE IF NOT EXISTS nametag_lookup_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id    UUID NOT NULL,
  user_id     TEXT NOT NULL,
  guest_count INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nametag_lookup_audit_user_created_idx ON nametag_lookup_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS nametag_lookup_audit_party_created_idx ON nametag_lookup_audit (party_id, created_at DESC);
ALTER TABLE nametag_lookup_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON nametag_lookup_audit FROM anon, authenticated;
