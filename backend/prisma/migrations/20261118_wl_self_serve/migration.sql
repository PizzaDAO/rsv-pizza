-- wl-self-serve-brands PR 1 (plans/wl-self-serve-brands.md, folded plans/wl-custom-domain-email.md):
-- everything the self-serve brand work needs in ONE additive schema change (PRs 1-16).
--   * event_series: runtime brand config, custom-domain email sender, custom-domain request columns.
--   * series_admins: partner brand admins (invite by email, hashed single-use token).
--   * series_audit: append-only audit log of brand/series writes.
-- All new columns are nullable or defaulted, so existing rows and code keep working unchanged.
-- NOT applied by the PR: apply to prod BEFORE merging (backend/scripts/apply-wl-self-serve.cjs --apply).
-- Prisma SELECTs every declared field, so merging schema.prisma ahead of this migration 500s every
-- event_series query.
-- event_series stays backend-only: no anon/authenticated grant and no SAFE_PARTY_COLUMNS change.
-- The two new tables get RLS enabled with no policies + no anon/authenticated grants.

-- Runtime brand config
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "tagline" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "meta_description" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "support_email" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "favicon_url" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "logo_light_url" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "theme_tokens" JSONB;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "flyer_art" JSONB;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "config_version" INTEGER NOT NULL DEFAULT 1;

-- Custom domain + sending address (server-written fields: email_domain_verified_at, resend_domain_id)
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "site_aliases" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "email_from_address" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "email_from_name" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "email_reply_to" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "email_domain" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "resend_domain_id" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "email_domain_verified_at" TIMESTAMPTZ;

-- Custom domain request (status: requested | dns_ok | attached | live | failed; validated in code)
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "pending_domain" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "pending_domain_token" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "pending_domain_status" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "pending_domain_checked_at" TIMESTAMPTZ;

-- Partner brand admins
CREATE TABLE IF NOT EXISTS "series_admins" (
  "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
  "series_id"           UUID NOT NULL,
  "email"               TEXT NOT NULL,
  "user_id"             TEXT,
  "role"                TEXT NOT NULL DEFAULT 'editor',
  "status"              TEXT NOT NULL DEFAULT 'invited',
  "alerts_enabled"      BOOLEAN NOT NULL DEFAULT true,
  "invite_token_hash"   TEXT,
  "invite_expires_at"   TIMESTAMPTZ,
  "invited_by"          TEXT NOT NULL,
  "accepted_at"         TIMESTAMPTZ,
  "revoked_at"          TIMESTAMPTZ,
  "revoked_by"          TEXT,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "series_admins_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "series_admins_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "event_series"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "series_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "series_admins_role_check" CHECK ("role" IN ('owner', 'editor')),
  CONSTRAINT "series_admins_status_check" CHECK ("status" IN ('invited', 'active', 'revoked'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "series_admins_series_id_email_key" ON "series_admins" ("series_id", "email");
CREATE INDEX IF NOT EXISTS "series_admins_email_idx" ON "series_admins" ("email");
CREATE INDEX IF NOT EXISTS "series_admins_invite_token_hash_idx" ON "series_admins" ("invite_token_hash");
ALTER TABLE "series_admins" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "series_admins" FROM anon;
REVOKE ALL ON "series_admins" FROM authenticated;

-- Append-only audit log
CREATE TABLE IF NOT EXISTS "series_audit" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "series_id"   UUID NOT NULL,
  "actor_email" TEXT NOT NULL,
  "actor_kind"  TEXT NOT NULL,
  "action"      TEXT NOT NULL,
  "changes"     JSONB,
  "snapshot"    JSONB,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "series_audit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "series_audit_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "event_series"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "series_audit_actor_kind_check" CHECK ("actor_kind" IN ('super_admin', 'series_admin', 'system'))
);
CREATE INDEX IF NOT EXISTS "series_audit_series_id_created_at_idx" ON "series_audit" ("series_id", "created_at" DESC);
ALTER TABLE "series_audit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "series_audit" FROM anon;
REVOKE ALL ON "series_audit" FROM authenticated;
