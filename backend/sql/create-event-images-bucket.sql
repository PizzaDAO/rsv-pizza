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

-- Policy: Anyone can view images in event-images bucket (public bucket)
CREATE POLICY "Anyone can view event images"
ON storage.objects
FOR SELECT
TO anon, authenticated, public
USING (bucket_id = 'event-images');

-- Policy: Anyone can delete their own uploads (optional, based on file path)
CREATE POLICY "Anyone can delete event images"
ON storage.objects
FOR DELETE
TO anon, authenticated
USING (bucket_id = 'event-images');
