-- romana-61204: Post-event guest survey
-- Adds a per-guest tokenized survey link, a survey_responses table, and
-- party-level survey toggle + sent-at timestamp.

-- 1. Per-guest survey token (unique, used in the /survey/:token public link).
ALTER TABLE guests
  ADD COLUMN survey_token UUID UNIQUE;

CREATE INDEX idx_guests_survey_token ON guests(survey_token);

-- 2. Survey responses. One row per guest (resubmit = upsert keyed on guest_id).
CREATE TABLE survey_responses (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id             UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  guest_id             UUID NOT NULL UNIQUE REFERENCES guests(id) ON DELETE CASCADE,
  email                TEXT NOT NULL,
  question_set_version INT NOT NULL,
  answers              JSONB NOT NULL,
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ
);

CREATE INDEX idx_survey_responses_party ON survey_responses(party_id, submitted_at DESC);

-- RLS enabled with no policies => deny-all for anon/authenticated.
-- Service-role (backend) bypasses RLS, so the survey endpoints can read/write
-- freely while the table stays inaccessible to browser clients.
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

-- 3. Party-level survey settings.
ALTER TABLE parties
  ADD COLUMN survey_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN survey_sent_at TIMESTAMPTZ;

-- Column-level SELECT grant required since the Feb 2026 security audit
-- switched parties from table-level to column-level SELECT.
-- survey_enabled is read by the public-facing frontend; survey_sent_at is
-- server-side only (no grant). survey_token / survey_responses are accessed
-- only via the backend service role (no anon grants).
GRANT SELECT (survey_enabled) ON parties TO anon, authenticated;
