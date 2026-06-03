-- panzerotti-58931: superlative submissions for the party check-in game.
-- Separate from guest_scorecard_items; entries are judged after the event
-- (Phase 2) and are worth 0 points until then.
CREATE TABLE superlative_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id uuid NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  superlative_key varchar NOT NULL, -- 'super_slices', 'super_cheese_pull', 'super_box_stack'
  photo_url text NOT NULL,
  numeric_value int,
  status varchar NOT NULL DEFAULT 'pending', -- 'pending', 'winner', 'rejected'
  judged_by text,
  judged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (guest_id, party_id, superlative_key)
);

CREATE INDEX idx_superlative_party ON superlative_submissions(party_id);
CREATE INDEX idx_superlative_key_status ON superlative_submissions(superlative_key, status);

-- RLS policies (mirror guest_scorecard_items)
ALTER TABLE superlative_submissions ENABLE ROW LEVEL SECURITY;

-- Guests can read their own superlative submissions
CREATE POLICY "Guests can read own superlative submissions"
  ON superlative_submissions FOR SELECT
  USING (auth.uid()::text IN (
    SELECT g.id::text FROM guests g WHERE g.id = superlative_submissions.guest_id
  ));

-- Guests can insert their own superlative submissions
CREATE POLICY "Guests can insert own superlative submissions"
  ON superlative_submissions FOR INSERT
  WITH CHECK (auth.uid()::text IN (
    SELECT g.id::text FROM guests g WHERE g.id = superlative_submissions.guest_id
  ));

-- Guests can update their own superlative submissions
CREATE POLICY "Guests can update own superlative submissions"
  ON superlative_submissions FOR UPDATE
  USING (auth.uid()::text IN (
    SELECT g.id::text FROM guests g WHERE g.id = superlative_submissions.guest_id
  ));

-- Service role has full access (backend upsert + Phase 2 judging)
CREATE POLICY "Service role full access superlatives"
  ON superlative_submissions FOR ALL
  USING (auth.role() = 'service_role');
