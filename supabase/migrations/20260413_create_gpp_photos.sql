-- GPP (Global Pizza Party) Photos table
-- Stores historical party photos from previous years' Global Pizza Party events
-- Photos are hosted on app.gpp.day — URLs stored here for mapping to RSVPizza events
-- These are read-only imports, separate from the user-uploaded photos table

CREATE TABLE gpp_photos (
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

CREATE INDEX idx_gpp_photos_party_id ON gpp_photos(party_id);
CREATE INDEX idx_gpp_photos_city_slug ON gpp_photos(city_slug);

ALTER TABLE gpp_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gpp_photos_public_read" ON gpp_photos FOR SELECT USING (true);
