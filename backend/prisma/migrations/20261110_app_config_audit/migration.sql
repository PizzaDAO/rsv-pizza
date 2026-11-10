-- Audit log for admin edits made through the generic settings UI (host-trust settings first).
-- Additive, new table only. NOT applied by the PR: apply to prod before merging (see CLAUDE.md).
-- RLS enabled with no policies so the table is unreachable via the anon key
-- (same convention as 20261029_host_fast_pass).
CREATE TABLE IF NOT EXISTS "app_config_audit" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "key"         TEXT NOT NULL,
  "old_value"   INTEGER NOT NULL,
  "new_value"   INTEGER NOT NULL,
  "actor_email" TEXT NOT NULL,
  "note"        TEXT,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "app_config_audit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "app_config_audit_key_created_at_idx"
  ON "app_config_audit" ("key", "created_at" DESC);
ALTER TABLE "app_config_audit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "app_config_audit" FROM anon;
REVOKE ALL ON "app_config_audit" FROM authenticated;
