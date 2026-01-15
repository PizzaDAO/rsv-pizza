# Supabase Storage Setup for Event Images

The event image upload feature requires a Supabase Storage bucket. Follow these steps to set it up:

## Option 1: Manual Setup (Recommended)

1. **Go to Supabase Dashboard**
   - Navigate to https://supabase.com/dashboard
   - Select your project: `znpiwdvvsqaxuskpfleo`

2. **Create Storage Bucket**
   - Click **Storage** in the left sidebar
   - Click **New bucket** button
   - Configure the bucket:
     - **Name**: `event-images`
     - **Public bucket**: ✅ YES (check this box)
     - **File size limit**: `5242880` (5MB in bytes)
     - **Allowed MIME types**:
       ```
       image/jpeg
       image/jpg
       image/png
       image/gif
       image/webp
       ```

3. **Set Permissions (RLS Policies)**
   - After creating the bucket, go to **Storage** → **Policies**
   - Click **New Policy** on the `storage.objects` table
   - Create 3 policies:

   **Policy 1: Upload**
   ```sql
   CREATE POLICY "Anyone can upload event images"
   ON storage.objects
   FOR INSERT
   TO anon, authenticated
   WITH CHECK (bucket_id = 'event-images');
   ```

   **Policy 2: View**
   ```sql
   CREATE POLICY "Anyone can view event images"
   ON storage.objects
   FOR SELECT
   TO anon, authenticated, public
   USING (bucket_id = 'event-images');
   ```

   **Policy 3: Delete**
   ```sql
   CREATE POLICY "Anyone can delete event images"
   ON storage.objects
   FOR DELETE
   TO anon, authenticated
   USING (bucket_id = 'event-images');
   ```

## Option 2: SQL Script

Alternatively, run this SQL in the Supabase SQL Editor:

```sql
-- Create bucket (if it doesn't exist)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-images',
  'event-images',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY IF NOT EXISTS "Anyone can upload event images"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'event-images');

CREATE POLICY IF NOT EXISTS "Anyone can view event images"
ON storage.objects FOR SELECT TO anon, authenticated, public
USING (bucket_id = 'event-images');

CREATE POLICY IF NOT EXISTS "Anyone can delete event images"
ON storage.objects FOR DELETE TO anon, authenticated
USING (bucket_id = 'event-images');
```

## Verify Setup

Run this command to test the bucket:

```bash
node scripts/check-storage-bucket.js
```

You should see:
```
✅ Storage bucket is working correctly!
```

## Troubleshooting

### Error: "Bucket not found"
- Make sure the bucket name is exactly `event-images`
- Check that the bucket is set to **public**

### Error: "Policy violation" or "Permission denied"
- Verify RLS policies are created on `storage.objects`
- Check that policies allow `anon` role (anonymous users)
- Make sure `WITH CHECK (bucket_id = 'event-images')` is in the policy

### Error: "File too large"
- Check the file size limit is set to 5MB (5242880 bytes)
- Verify the uploaded image is under 5MB

### Error: "MIME type not allowed"
- Make sure the allowed MIME types include your image format
- Check that the file is actually an image (not a renamed file)

## Using Image URLs Instead

If you don't want to set up storage, you can:
1. Upload images to any image hosting service (Imgur, Cloudinary, etc.)
2. Use the **image URL** input instead of file upload
3. Paste the direct image URL (must end in .jpg, .png, etc.)

## Current Status

Check if the bucket exists:
```bash
node scripts/check-storage-bucket.js
```

If not found, follow Option 1 (Manual Setup) above.
