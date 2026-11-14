-- durable-rate-limits: cross-instance counters for the sign-in code budgets
-- (backend/src/lib/authRateLimit.ts, lib/loginCode.ts). One row per reserved send / code check.
-- bucket = 'send' | 'verify_ip' | 'verify_ip_code_only' | 'verify_email_ip';
-- key = HMAC-SHA256 digest of the IP or email|IP (never plaintext).
-- Rows older than 1 hour are useless (every window is 15 min) and are deleted opportunistically.
-- Additive, new table only. NOT applied by the PR: apply to prod BEFORE merging
-- (backend/scripts/apply-auth-rate-events.cjs). Without it /api/auth/verify-code answers 503.
-- RLS enabled with no policies + no anon/authenticated grants: backend only.
CREATE TABLE IF NOT EXISTS "auth_rate_events" (
  "id"         BIGSERIAL NOT NULL,
  "bucket"     TEXT NOT NULL,
  "key"        TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "auth_rate_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "auth_rate_events_bucket_key_created_at_idx"
  ON "auth_rate_events" ("bucket", "key", "created_at");
-- For the opportunistic cleanup DELETE ... WHERE created_at < now() - interval '1 hour'.
CREATE INDEX IF NOT EXISTS "auth_rate_events_created_at_idx"
  ON "auth_rate_events" ("created_at");
ALTER TABLE "auth_rate_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "auth_rate_events" FROM anon;
REVOKE ALL ON "auth_rate_events" FROM authenticated;
REVOKE ALL ON SEQUENCE "auth_rate_events_id_seq" FROM anon;
REVOKE ALL ON SEQUENCE "auth_rate_events_id_seq" FROM authenticated;
