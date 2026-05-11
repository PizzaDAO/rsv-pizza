-- Create guest scorecard items table for gamified engagement tracking
CREATE TABLE guest_scorecard_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  item_key VARCHAR NOT NULL, -- 'post', 'photo', 'vouch', 'pizza_selfie', 'sticker', 'follow_pizzadao', 'signup_pizzadao'
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  proof_url TEXT,
  proof_type VARCHAR, -- 'tweet_url', 'photo_id', 'auto', 'self_report'
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (guest_id, party_id, item_key)
);

CREATE INDEX idx_scorecard_guest_party ON guest_scorecard_items(guest_id, party_id);
CREATE INDEX idx_scorecard_party ON guest_scorecard_items(party_id);

-- RLS policies
ALTER TABLE guest_scorecard_items ENABLE ROW LEVEL SECURITY;

-- Guests can read their own scorecard items
CREATE POLICY "Guests can read own scorecard items"
  ON guest_scorecard_items FOR SELECT
  USING (auth.uid()::text IN (
    SELECT g.id::text FROM guests g WHERE g.id = guest_scorecard_items.guest_id
  ));

-- Guests can insert their own scorecard items
CREATE POLICY "Guests can insert own scorecard items"
  ON guest_scorecard_items FOR INSERT
  WITH CHECK (auth.uid()::text IN (
    SELECT g.id::text FROM guests g WHERE g.id = guest_scorecard_items.guest_id
  ));

-- Guests can update their own scorecard items
CREATE POLICY "Guests can update own scorecard items"
  ON guest_scorecard_items FOR UPDATE
  USING (auth.uid()::text IN (
    SELECT g.id::text FROM guests g WHERE g.id = guest_scorecard_items.guest_id
  ));

-- Service role has full access (for backend auto-completion)
CREATE POLICY "Service role full access"
  ON guest_scorecard_items FOR ALL
  USING (auth.role() = 'service_role');
