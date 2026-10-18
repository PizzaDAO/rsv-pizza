-- Fix Storage Policies for event-images bucket
-- Run this in Supabase SQL Editor

-- First, drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Anyone can upload event images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view event images" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete event images" ON storage.objects;

-- Enable RLS on storage.objects (if not already enabled)
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy 1: Allow anonymous uploads to event-images bucket
CREATE POLICY "Anyone can upload event images"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'event-images');

-- marinara-61842: Policies 2-4 (SELECT / DELETE / UPDATE TO public) were removed.
-- The SELECT policy let anon LIST every object in the bucket (incl. payout
-- receipts); public image URLs don't need it. DELETE/UPDATE let anyone remove or
-- overwrite any object. Do not re-add them. See
-- supabase/migrations/20261018_marinara_61842_lockdown_event_images_listing.sql.

-- Verify policies were created
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'objects'
  AND policyname LIKE '%event images%'
ORDER BY policyname;
