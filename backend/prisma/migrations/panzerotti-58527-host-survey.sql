-- panzerotti-58527: post-event HOST survey.
-- Mirrors the guest survey tables (survey_question_sets / survey_questions /
-- survey_responses) but with a SEPARATE question set targeted at hosts.
-- Recipients = primary host only. One response row per party (unique party_id).
-- Idempotent so it is safe to re-run.

CREATE TABLE IF NOT EXISTS host_survey_question_sets (
  id text PRIMARY KEY,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS host_survey_questions (
  id text NOT NULL,
  question_set text NOT NULL REFERENCES host_survey_question_sets(id),
  position integer NOT NULL,
  type text NOT NULL,
  text text NOT NULL,
  scale integer,
  multi boolean NOT NULL DEFAULT false,
  allow_other boolean NOT NULL DEFAULT false,
  options jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_set, id),
  UNIQUE (question_set, position)
);

CREATE TABLE IF NOT EXISTS host_survey_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL,
  party_id uuid NOT NULL UNIQUE REFERENCES parties(id) ON DELETE CASCADE,
  host_user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  sent_at timestamptz,
  answers jsonb,
  submitted_at timestamptz,
  question_set_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

ALTER TABLE parties ADD COLUMN IF NOT EXISTS host_survey_sent_at timestamptz;

-- Seed the default host question set (6 questions, positions 1-6).
INSERT INTO host_survey_question_sets (id, version)
  VALUES ('default', 1)
  ON CONFLICT (id) DO NOTHING;

INSERT INTO host_survey_questions (question_set, id, position, type, text, scale)
  VALUES
    ('default', 'event_rating', 1, 'rating', 'How would you rate your event overall?', 5),
    ('default', 'program_support', 4, 'rating', 'How would you rate the support you got from the PizzaDAO program?', 5)
  ON CONFLICT (question_set, id) DO NOTHING;

INSERT INTO host_survey_questions (question_set, id, position, type, text)
  VALUES
    ('default', 'same_pizzeria', 2, 'yesno', 'Would you use the same pizzeria again?'),
    ('default', 'venue_ok', 3, 'yesno', 'Did the venue work out well?'),
    ('default', 'host_again', 5, 'yesno', 'Would you host again next year?'),
    ('default', 'improve', 6, 'text', 'What could we do to make hosting easier or better?')
  ON CONFLICT (question_set, id) DO NOTHING;
