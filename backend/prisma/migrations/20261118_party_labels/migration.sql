-- blackolive-70521: host-chosen public event tags (curated keys). Distinct from event_tags
-- (admin/system control channel). Additive. NOT applied by the PR: apply to prod BEFORE merging
-- (backend/scripts/apply-party-labels.cjs).
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "labels" TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS "idx_parties_labels_gin" ON "parties" USING GIN ("labels");
GRANT SELECT ("labels") ON "parties" TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
