-- Add fields for managing "Photos from Previous Years" on the host dashboard
-- hidden_gpp_photos: array of photo src paths (from app.gpp.day) that the host has hidden
-- extra_gpp_photos: array of URLs for host-uploaded historical photos

ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS hidden_gpp_photos jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS extra_gpp_photos jsonb DEFAULT '[]'::jsonb;

-- Add a comment for documentation
COMMENT ON COLUMN parties.hidden_gpp_photos IS 'Array of app.gpp.day photo src paths hidden by the host';
COMMENT ON COLUMN parties.extra_gpp_photos IS 'Array of host-uploaded previous year photo URLs';
