-- napoletana-58211: link payout_documents.photo_id to photos.id for kind='pizza'.
-- Receipts (kind='receipt') keep photo_id NULL.
-- ON DELETE SET NULL so deleting the photos row doesn't cascade and lose the payout record.

ALTER TABLE "payout_documents"
  ADD COLUMN "photo_id" UUID NULL
    REFERENCES "photos"("id") ON DELETE SET NULL;

CREATE INDEX "payout_documents_photo_id_idx" ON "payout_documents" ("photo_id");
