-- basil-14648: AI ordering through pizza-mcp (OPOP). Additive only: two new tables
-- plus two columns on payout_documents (one defaulted, one nullable). Safe to apply
-- before the code ships; nothing reads these until the feature is allowlisted.
-- RLS enabled with no policies and anon/authenticated revoked (same convention as
-- 20260924_taxform_rls_lockdown): the backend uses the Prisma connection.

CREATE TABLE IF NOT EXISTS "pizza_orders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "party_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "opop_order_id" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "shop_name" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "payment_status" TEXT,
  "ceiling_cents" INTEGER,
  "confirmed_total_cents" INTEGER,
  "ready_at" TIMESTAMPTZ,
  "ready_at_text" TEXT,
  "summary" TEXT,
  "last_view" JSONB,
  "next_action" JSONB,
  "timeline_len" INTEGER NOT NULL DEFAULT 0,
  "last_event_at" TIMESTAMPTZ,
  "payout_document_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "pizza_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pizza_orders_party_id_fkey"
    FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "pizza_orders_opop_order_id_key" ON "pizza_orders"("opop_order_id");
CREATE INDEX IF NOT EXISTS "pizza_orders_party_id_idx" ON "pizza_orders"("party_id");
CREATE INDEX IF NOT EXISTS "pizza_orders_user_id_idx" ON "pizza_orders"("user_id");
ALTER TABLE "pizza_orders" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "pizza_orders" FROM anon;
REVOKE ALL ON "pizza_orders" FROM authenticated;

CREATE TABLE IF NOT EXISTS "pizza_webhook_events" (
  "id" TEXT NOT NULL,
  "received_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "pizza_webhook_events_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "pizza_webhook_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "pizza_webhook_events" FROM anon;
REVOKE ALL ON "pizza_webhook_events" FROM authenticated;

-- 'upload' for every existing row; drafts written by the webhook use 'ai_call' / 'opop_native'.
ALTER TABLE "payout_documents" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE "payout_documents" ADD COLUMN IF NOT EXISTS "pizza_order_id" UUID;
DO $$ BEGIN
  ALTER TABLE "payout_documents" ADD CONSTRAINT "payout_documents_source_check"
    CHECK ("source" IN ('upload', 'ai_call', 'opop_native'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "payout_documents" ADD CONSTRAINT "payout_documents_pizza_order_id_fkey"
    FOREIGN KEY ("pizza_order_id") REFERENCES "pizza_orders"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- One draft receipt per order (NULLs are distinct, so uploads are unaffected).
CREATE UNIQUE INDEX IF NOT EXISTS "payout_documents_pizza_order_id_key" ON "payout_documents"("pizza_order_id");
