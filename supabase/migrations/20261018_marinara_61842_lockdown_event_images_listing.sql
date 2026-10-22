-- marinara-61842 SECURITY FIX: stop anon/authenticated from LISTING the
-- `event-images` storage bucket.
--
-- Finding (verified live 2026-10-18 with only the public anon key from the
-- rsv.pizza bundle): POST /storage/v1/object/list/event-images returned every
-- object in the bucket (~15.4k), including host payout receipts under
-- payouts/<partyId>/<tmpId>/receipt/*.{jpg,png,pdf} (names, addresses, card
-- digits). Object paths carry random suffixes, so listing is the only practical
-- way to enumerate them.
--
-- Cause: the storage.objects policy "Anyone can view event images"
--   FOR SELECT TO public USING (bucket_id = 'event-images')
-- (created by backend/sql/fix-storage-policies.sql). Storage's list endpoint
-- (storage.search / list_objects_with_delimiter) runs as the caller and is
-- filtered by storage.objects SELECT policies, so this policy exposes every row.
--
-- Why dropping it is safe:
--   * event-images is a PUBLIC bucket (storage.buckets.public = true). Public
--     reads (/storage/v1/object/public/event-images/..., the /cdn/* Vercel
--     rewrite, /render/image/public/...) are served without consulting
--     storage.objects RLS, so every image URL on the site keeps working.
--   * Every browser upload to event-images uses upsert:false
--     (frontend/src/lib/supabase.ts), which needs only the INSERT policy
--     "Anyone can upload event images" (kept). Supabase requires SELECT(+UPDATE)
--     only for upsert:true.
--   * No app code lists, downloads, moves, copies or removes event-images objects
--     with the anon key; all backend storage writes use the service_role key,
--     which bypasses RLS.
--   * The browser client has no Supabase Auth session (app auth is a custom JWT),
--     so `authenticated` never reaches storage either; dropping the policy closes
--     listing for anon AND authenticated.
--
-- Rollback (only if uploads break after apply; re-opens listing):
--   CREATE POLICY "Anyone can view event images" ON storage.objects
--     FOR SELECT TO public USING (bucket_id = 'event-images');

DROP POLICY IF EXISTS "Anyone can view event images" ON storage.objects;

-- Defense in depth: these were defined in backend/sql/fix-storage-policies.sql
-- but are NOT present in prod as of 2026-10-18. Drop them if they ever appear so
-- anon can't overwrite or delete any event-images object.
DROP POLICY IF EXISTS "Anyone can update event images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete event images" ON storage.objects;
