-- margherita-43821: composite index supporting GET /api/photos/feed.
-- Filters: starred=true AND status='approved' (+ joins into Party for
-- underbossStatus/photosPublic/photosEnabled), ordered by (created_at DESC,
-- id DESC) for cursor pagination. The leading (starred, status) columns are
-- highly selective even before the orderBy kicks in.
--
-- NOTE: Prisma wraps migrations in a single transaction, so we use the plain
-- non-CONCURRENTLY form here. In prod we will apply this via Supabase MCP
-- using the CONCURRENTLY variant to avoid an exclusive lock on `photos`:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "photos_starred_status_created_at_id_idx"
--     ON "photos" ("starred", "status", "created_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "photos_starred_status_created_at_id_idx"
  ON "photos" ("starred", "status", "created_at" DESC, "id" DESC);
