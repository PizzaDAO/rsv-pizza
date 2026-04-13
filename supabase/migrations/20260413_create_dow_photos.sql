-- DOW (Day of Wonder) Photos table
-- Stores historical party photos imported from the DOW Pizza Party project
-- These are read-only imports, separate from the user-uploaded photos table

CREATE TABLE dow_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
  city_slug TEXT NOT NULL,
  city_name TEXT NOT NULL,
  country_code TEXT,
  year INT NOT NULL DEFAULT 2025,
  photo_index INT NOT NULL,
  storage_url TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_size INT,
  width INT,
  height INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dow_photos_party_id ON dow_photos(party_id);
CREATE INDEX idx_dow_photos_city_slug ON dow_photos(city_slug);

ALTER TABLE dow_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dow_photos_public_read" ON dow_photos FOR SELECT USING (true);
