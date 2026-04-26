CREATE TABLE partner_event_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_user_id UUID NOT NULL REFERENCES sponsor_users(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sponsor_user_id, party_id)
);
CREATE INDEX idx_partner_event_notes_sponsor ON partner_event_notes(sponsor_user_id);
CREATE INDEX idx_partner_event_notes_party ON partner_event_notes(party_id);
