-- Idempotency + audit log for /api/service/telegram/* sends (DMs and city-group
-- posts made on behalf of the PizzaDAO member app). Additive, new table only.
-- RLS enabled with no policies so the table is unreachable via the anon key
-- (same convention as 20261029_host_fast_pass).
CREATE TABLE IF NOT EXISTS "pizzadao_service_sends" (
  "idempotency_key" TEXT NOT NULL,
  "kind"            TEXT NOT NULL,          -- dm | city_post
  "target"          TEXT NOT NULL,          -- telegram user id, or city key
  "status"          TEXT NOT NULL,          -- pending | sent | failed | uncertain
  "message_id"      BIGINT,
  "code"            TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "pizzadao_service_sends_pkey" PRIMARY KEY ("idempotency_key")
);
CREATE INDEX IF NOT EXISTS "pizzadao_service_sends_target_idx"
  ON "pizzadao_service_sends" ("kind", "target", "created_at");
ALTER TABLE "pizzadao_service_sends" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "pizzadao_service_sends" FROM anon;
REVOKE ALL ON "pizzadao_service_sends" FROM authenticated;
