-- provolone-58931: soft-delete support for host photos and budget items.
-- Hosts/co-hosts/public never see rows where deleted_at is set; super-admins
-- see them greyed with a "Deleted by host" badge and can restore (clear deleted_at).

ALTER TABLE "photos"       ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
ALTER TABLE "budget_items" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;

CREATE INDEX IF NOT EXISTS "photos_party_id_deleted_at_idx"       ON "photos" ("party_id","deleted_at");
CREATE INDEX IF NOT EXISTS "budget_items_party_id_deleted_at_idx" ON "budget_items" ("party_id","deleted_at");
