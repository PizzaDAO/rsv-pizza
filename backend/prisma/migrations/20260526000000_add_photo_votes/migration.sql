-- salame-58195: thumbs-up voting on photos.
--
-- New table photo_votes records one vote per (photo_id, user_id) and a
-- denormalized vote_count on the photos table is maintained by the backend
-- toggle endpoint (no DB trigger). Logged-in users only — anonymous visitors
-- can read counts but cannot vote.
--
-- The User FK references the "User" table (PascalCase, singular) because the
-- Prisma User model has no @@map directive.

CREATE TABLE "photo_votes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "photo_id" UUID NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "photo_votes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "photo_votes_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE CASCADE,
  CONSTRAINT "photo_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "photo_votes_photo_id_user_id_key" UNIQUE ("photo_id", "user_id")
);

CREATE INDEX "photo_votes_photo_id_idx" ON "photo_votes" ("photo_id");
CREATE INDEX "photo_votes_user_id_idx" ON "photo_votes" ("user_id");

ALTER TABLE "photos" ADD COLUMN "vote_count" INT NOT NULL DEFAULT 0;
