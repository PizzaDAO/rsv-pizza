-- Venue photos table
CREATE TABLE IF NOT EXISTS venue_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INT NOT NULL,
  mime_type TEXT NOT NULL,
  width INT,
  height INT,
  caption TEXT,
  category TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_venue_photos_venue ON venue_photos(venue_id, sort_order);

-- Add pros/cons to venues
ALTER TABLE venues ADD COLUMN IF NOT EXISTS pros TEXT;
ALTER TABLE venues ADD COLUMN IF NOT EXISTS cons TEXT;

-- Add venue report fields to parties
ALTER TABLE parties ADD COLUMN IF NOT EXISTS venue_report_published BOOLEAN DEFAULT FALSE;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS venue_report_slug TEXT UNIQUE;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS venue_report_password TEXT;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS venue_report_title TEXT;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS venue_report_notes TEXT;

-- RLS policies for venue_photos
ALTER TABLE venue_photos ENABLE ROW LEVEL SECURITY;

-- Allow public read access to venue photos (needed for public venue report)
CREATE POLICY "Allow public read access to venue_photos"
  ON venue_photos FOR SELECT
  USING (true);

-- Allow authenticated inserts
CREATE POLICY "Allow authenticated insert venue_photos"
  ON venue_photos FOR INSERT
  TO authenticated
  WITH CHECK (true);
