# Photo Widget Setup Instructions

The Photo Widget feature has been implemented but may need some database and infrastructure setup.

## 1. Verify Database Table

The `photos` table needs to exist in the Supabase database. Run this SQL in the Supabase SQL Editor:

```sql
-- Check if photos table exists
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name = 'photos'
);

-- If it doesn't exist, run the migration:

-- Add photos-related columns to parties table if they don't exist
ALTER TABLE parties
ADD COLUMN IF NOT EXISTS photos_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS photos_public BOOLEAN DEFAULT TRUE;

-- Create photos table
CREATE TABLE IF NOT EXISTS photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,

    -- Upload info
    url TEXT NOT NULL,
    thumbnail_url TEXT,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    width INTEGER,
    height INTEGER,

    -- Uploader info
    uploaded_by UUID REFERENCES guests(id) ON DELETE SET NULL,
    uploader_name TEXT,
    uploader_email TEXT,

    -- Organization
    caption TEXT,
    tags TEXT[] DEFAULT '{}',
    starred BOOLEAN DEFAULT FALSE,
    starred_at TIMESTAMPTZ,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_photos_party_created ON photos(party_id, created_at);
CREATE INDEX IF NOT EXISTS idx_photos_party_starred ON photos(party_id, starred);
```

## 2. Verify Supabase Storage Bucket

Create a storage bucket named `event-photos` if it doesn't exist:

1. Go to Supabase Dashboard > Storage
2. Create new bucket named `event-photos`
3. Set it to **Public** (so photos can be viewed without auth)
4. Enable the following policies:
   - Allow public read access
   - Allow authenticated insert/delete (or public if you want guests to upload without login)

## 3. Verify Backend Deployment

The backend at `https://backend-pizza-dao.vercel.app` should have the latest code.

Test by running:
```bash
curl https://backend-pizza-dao.vercel.app/api/parties/test-id/photos/stats
```

If it returns `{"error":{"message":"No token provided",...}}`, the backend needs to be redeployed.

To redeploy:
1. Go to Vercel Dashboard
2. Find the "backend" project
3. Trigger a new deployment from the master branch

Or run locally:
```bash
cd backend
vercel --prod
```

## 4. Test the Feature

Once everything is set up:

1. **Host View**: Go to a party's host page, click the Photos tab
2. **Guest View**: Go to an event page, scroll down to see the Photos section
3. **Upload**: Click Upload button to add photos

## Files Changed

- `backend/src/routes/photo.routes.ts` - Route ordering fix
- `frontend/src/pages/EventPage.tsx` - Added PhotoGallery for guests
- `frontend/src/components/photos/` - Photo components

## Troubleshooting

### "Failed to load photos"
- Check if the photos table exists in the database
- Check browser console for network errors
- Check backend logs in Vercel

### Photos not displaying
- Verify the `event-photos` storage bucket exists and is public
- Check that the photo URLs are accessible

### Upload fails
- Verify Supabase anon key is configured in frontend
- Check storage bucket permissions
- Check file size (max 10MB)
