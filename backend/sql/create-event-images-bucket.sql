-- Create storage bucket for event images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-images',
  'event-images',
  true,
  5242880, -- 5MB in bytes
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can upload images to event-images bucket
CREATE POLICY "Anyone can upload event images"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'event-images');

-- marinara-61842: NO SELECT / DELETE / UPDATE policies for event-images.
-- The bucket is public, so /object/public/... URLs work without a SELECT policy;
-- a SELECT policy lets anon LIST every object (incl. payout receipts).
-- See supabase/migrations/20261018_marinara_61842_lockdown_event_images_listing.sql.
