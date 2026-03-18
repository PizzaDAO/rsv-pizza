-- Link click tracking table for event pages
CREATE TABLE link_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  link_type TEXT NOT NULL,
  link_label TEXT,
  visitor_hash TEXT,
  ip_address TEXT,
  user_agent TEXT,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_link_clicks_party_id ON link_clicks(party_id);
CREATE INDEX idx_link_clicks_party_url ON link_clicks(party_id, url);
CREATE INDEX idx_link_clicks_party_clicked_at ON link_clicks(party_id, clicked_at);
CREATE INDEX idx_link_clicks_party_visitor ON link_clicks(party_id, visitor_hash);
