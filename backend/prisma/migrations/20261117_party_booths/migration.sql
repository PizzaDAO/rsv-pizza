-- photo-booth: per-party setup for the phone photo booth (rsv.pizza/<party>/booth).
-- One row per party; no row = booth on with the PizzaDAO default. `config` is the sanitized booth
-- config JSON (can carry a ~1.5 MB logo data URL, which is why it is not a column on `parties`).
-- Additive, new table only. NOT applied by the PR: apply to prod BEFORE merging
-- (backend/scripts/apply-party-booths.cjs). Without it, GET /api/events/:slug (which selects the
-- `booth` relation) and /api/parties/:id/booth fail.
-- RLS enabled with no policies + no anon/authenticated grants: backend only.
CREATE TABLE IF NOT EXISTS "party_booths" (
  "party_id"   UUID NOT NULL,
  "enabled"    BOOLEAN NOT NULL DEFAULT true,
  "config"     JSONB,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_by" TEXT,
  CONSTRAINT "party_booths_pkey" PRIMARY KEY ("party_id"),
  CONSTRAINT "party_booths_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
ALTER TABLE "party_booths" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "party_booths" FROM anon;
REVOKE ALL ON "party_booths" FROM authenticated;
