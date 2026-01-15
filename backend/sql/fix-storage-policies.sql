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

-- Policy 2: Allow anyone to view event images (public bucket)
CREATE POLICY "Anyone can view event images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'event-images');

-- Policy 3: Allow anyone to delete event images
CREATE POLICY "Anyone can delete event images"
ON storage.objects
FOR DELETE
TO public
USING (bucket_id = 'event-images');

-- Policy 4: Allow anyone to update event images
CREATE POLICY "Anyone can update event images"
ON storage.objects
FOR UPDATE
TO public
USING (bucket_id = 'event-images');

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
