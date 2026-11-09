-- basil-14648 P2 (order-online handoff): the host's own "Order online" click and "I ordered it" mark.
-- Additive only: one new table, no change to any existing table (no locks on hot tables).
-- Kept OUT of pizza_orders on purpose: the OPOP sync/webhook code iterates pizza_orders and would poll a fake
-- opop_order_id. A marked handoff feeds budgetBreakdown as a confirmed order with no shop total.
-- No amount, order number or screenshot of the off-platform order is stored: hold_cents is OUR number (the
-- quote's price ceiling for the cart the checklist came from).
-- RLS enabled with no policies and anon/authenticated revoked (convention of 20261031_pizza_orders): only the
-- backend's Prisma connection reads or writes it. Apply to prod (SET lock_timeout) BEFORE merging the Prisma model.

CREATE TABLE IF NOT EXISTS "pizza_handoffs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "party_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "shop_id" TEXT NOT NULL,
  "shop_name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "opop_cart_id" TEXT,
  "quote_id" TEXT,
  "hold_cents" INTEGER NOT NULL DEFAULT 0,
  -- the last quote rsv saw for the checklist's cart (pizza-mcp numbers, never the external order's):
  -- the fallback hold when a mark cannot re-quote (pickup time passed, cart expired)
  "estimate_cents" INTEGER,
  "quote_ceiling_cents" INTEGER,
  "clicked_at" TIMESTAMPTZ,
  "ordered_at" TIMESTAMPTZ,
  "released_at" TIMESTAMPTZ,
  -- who took the mark back: its owner ("I didn't order after all") or a co-host who checked
  "released_by" TEXT,
  "receipt_covered_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "pizza_handoffs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pizza_handoffs_party_id_fkey"
    FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE,
  CONSTRAINT "pizza_handoffs_provider_chk"
    CHECK ("provider" IN ('toast','square_online','chownow','slice','bentobox','website','phone','in_person')),
  CONSTRAINT "pizza_handoffs_hold_chk" CHECK ("hold_cents" >= 0)
);
-- for a database that applied an earlier draft of this file
ALTER TABLE "pizza_handoffs" ADD COLUMN IF NOT EXISTS "estimate_cents" INTEGER;
ALTER TABLE "pizza_handoffs" ADD COLUMN IF NOT EXISTS "quote_ceiling_cents" INTEGER;
ALTER TABLE "pizza_handoffs" ADD COLUMN IF NOT EXISTS "released_by" TEXT;
ALTER TABLE "pizza_handoffs" DROP CONSTRAINT IF EXISTS "pizza_handoffs_provider_chk";
ALTER TABLE "pizza_handoffs" ADD CONSTRAINT "pizza_handoffs_provider_chk"
  CHECK ("provider" IN ('toast','square_online','chownow','slice','bentobox','website','phone','in_person'));
CREATE INDEX IF NOT EXISTS "pizza_handoffs_party_id_idx" ON "pizza_handoffs"("party_id");
ALTER TABLE "pizza_handoffs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "pizza_handoffs" FROM anon;
REVOKE ALL ON "pizza_handoffs" FROM authenticated;
