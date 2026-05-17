-- nduja-58792: Bitcoin Pizza Day livestream Zoom registrants table
-- Service-role / backend only; no anon or authenticated grants.

CREATE TABLE IF NOT EXISTS stream_registrants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  party_id UUID REFERENCES parties(id) ON DELETE SET NULL,
  zoom_meeting_id TEXT NOT NULL,
  zoom_registrant_id TEXT,
  zoom_join_url TEXT,
  display_name TEXT,
  email_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stream_registrants_email_meeting_unique UNIQUE (email, zoom_meeting_id)
);

CREATE INDEX IF NOT EXISTS stream_registrants_email_idx ON stream_registrants (lower(email));
CREATE INDEX IF NOT EXISTS stream_registrants_meeting_idx ON stream_registrants (zoom_meeting_id);

-- RLS on, no policies = deny-all for anon/authenticated. Service role bypasses RLS.
ALTER TABLE stream_registrants ENABLE ROW LEVEL SECURITY;
