-- Sizzle reels: queue + results for the Railway reel-worker (reel-worker/).
-- Additive, new table only. Backend and worker use the service role / direct
-- Postgres connection; RLS is enabled with no policies so the table is
-- unreachable via the anon key (same convention as host_fast_pass_approvals).
CREATE TABLE IF NOT EXISTS "reels" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "party_id" UUID NOT NULL,
  "requested_by" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "spec" JSONB NOT NULL,
  "outputs" JSONB,
  "error" TEXT,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "started_at" TIMESTAMPTZ,
  "finished_at" TIMESTAMPTZ,
  CONSTRAINT "reels_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reels_party_id_fkey"
    FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE,
  CONSTRAINT "reels_status_check" CHECK ("status" IN ('queued', 'rendering', 'ready', 'failed'))
);
CREATE INDEX IF NOT EXISTS "reels_status_created_at_idx" ON "reels"("status", "created_at");
CREATE INDEX IF NOT EXISTS "reels_party_id_created_at_idx" ON "reels"("party_id", "created_at");
ALTER TABLE "reels" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "reels" FROM anon;
REVOKE ALL ON "reels" FROM authenticated;
