-- scamorza-71819: per-partner AI-share token table powering the read-only
-- consolidated-report endpoint that LLM assistants can fetch on the partner's
-- behalf. The table was already applied to prod manually; this file exists for
-- migration-history parity so a fresh `prisma migrate deploy` doesn't try to
-- re-apply.
--
-- One active row per (sponsor_user_id, tag) — rotating issues a new row and
-- soft-revokes the old one. The partial unique index enforces the
-- "one active token per tag" invariant in SQL.

CREATE TABLE "partner_ai_share_tokens" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sponsor_user_id" UUID NOT NULL REFERENCES "sponsor_users"("id") ON DELETE CASCADE,
  "tag"             TEXT NOT NULL,
  "token"           TEXT NOT NULL UNIQUE,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_used_at"    TIMESTAMPTZ,
  "revoked_at"      TIMESTAMPTZ
);

CREATE UNIQUE INDEX "partner_ai_share_tokens_active_unique"
  ON "partner_ai_share_tokens" ("sponsor_user_id", "tag")
  WHERE "revoked_at" IS NULL;

CREATE INDEX "partner_ai_share_tokens_token_active_idx"
  ON "partner_ai_share_tokens" ("token")
  WHERE "revoked_at" IS NULL;
