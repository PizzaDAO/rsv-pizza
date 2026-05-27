-- napoletana-58210: thumbs-up voting on payout-document photos.
--
-- The /photos feed and event-page galleries now union photos from two tables:
-- the existing `photos` table (curated, with star+approve flags) and
-- `payout_documents` filtered to kind='pizza' (uncurated, auto-approved).
-- Voting on each source uses its own table to keep the FK clean. This file
-- introduces `payout_document_votes` (mirror of `photo_votes`) plus a
-- denormalized `vote_count` column on `payout_documents`.
--
-- The User FK references the "User" table (PascalCase, singular) because the
-- Prisma User model has no @@map directive — matches the photo_votes pattern.

CREATE TABLE "payout_document_votes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "payout_document_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "payout_document_votes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payout_document_votes_payout_document_id_fkey" FOREIGN KEY ("payout_document_id") REFERENCES "payout_documents"("id") ON DELETE CASCADE,
  CONSTRAINT "payout_document_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "payout_document_votes_unique" UNIQUE ("payout_document_id", "user_id")
);

CREATE INDEX "payout_document_votes_doc_idx" ON "payout_document_votes" ("payout_document_id");
CREATE INDEX "payout_document_votes_user_idx" ON "payout_document_votes" ("user_id");

ALTER TABLE "payout_documents" ADD COLUMN "vote_count" INT NOT NULL DEFAULT 0;
