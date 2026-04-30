-- Create slug_aliases table for old-slug -> new-slug redirects
CREATE TABLE slug_aliases (
  old_slug   TEXT PRIMARY KEY,
  party_id   UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_slug_aliases_party_id ON slug_aliases(party_id);

ALTER TABLE slug_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "slug_aliases_select" ON slug_aliases FOR SELECT USING (true);

GRANT SELECT ON slug_aliases TO anon, authenticated;
