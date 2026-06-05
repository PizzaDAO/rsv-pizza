-- pugliese-58297: move post-event survey question config from code constants to DB.
--
-- Two tables back the survey question set:
--  * survey_question_sets — one row per set id (currently only 'default'); the
--    `version` is bumped manually when the question set changes so old answers
--    can be interpreted against the version they were collected under.
--  * survey_questions     — the individual questions, ordered by `position`.
--
-- Access model: service-role only (no anon/authenticated GRANTs). Reads happen
-- in the Express backend via Prisma + service-role connection; the public
-- survey API still serializes the question set into the JSON response.

CREATE TABLE IF NOT EXISTS survey_question_sets (
  id          text PRIMARY KEY,
  version     int  NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS survey_questions (
  id            text NOT NULL,
  question_set  text NOT NULL REFERENCES survey_question_sets(id),
  position      int  NOT NULL,
  type          text NOT NULL CHECK (type IN ('rating','yesno','multiple','text')),
  text          text NOT NULL,
  scale         int,
  multi         boolean NOT NULL DEFAULT false,
  allow_other   boolean NOT NULL DEFAULT false,
  options       jsonb NOT NULL DEFAULT '[]'::jsonb,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_set, id),
  UNIQUE (question_set, position)
);

CREATE INDEX IF NOT EXISTS idx_survey_questions_set_pos
  ON survey_questions(question_set, position)
  WHERE active;

-- ---------------------------------------------------------------------------
-- Seed: 1:1 migration of the current code constants in
-- backend/src/lib/surveyQuestions.ts (SURVEY_QUESTION_SET_VERSION = 3, 8 Qs).
-- Exact ids / text / options / scale / multi / allow_other preserved.
-- ---------------------------------------------------------------------------

INSERT INTO survey_question_sets (id, version, updated_at)
VALUES ('default', 3, now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO survey_questions
  (id, question_set, position, type, text, scale, multi, allow_other, options, active)
VALUES
  ('attended',        'default', 1, 'yesno',    'Did you attend the event?',                  NULL, false, false, '[]'::jsonb,                                                                              true),
  ('overall_rating',  'default', 2, 'rating',   'How would you rate the event overall?',      5,    false, false, '[]'::jsonb,                                                                              true),
  ('pizza_rating',    'default', 3, 'rating',   'How was the pizza?',                          5,    false, false, '[]'::jsonb,                                                                              true),
  ('enough_pizza',    'default', 4, 'yesno',    'Was there enough pizza?',                     NULL, false, false, '[]'::jsonb,                                                                              true),
  ('recommend',       'default', 5, 'yesno',    'Would you come to another PizzaDAO event?',   NULL, false, false, '[]'::jsonb,                                                                              true),
  ('discovery',       'default', 6, 'multiple', 'How did you hear about this event?',          NULL, false, true,  '["A friend","Twitter/X","WhatsApp","The organizer","Brave Browser","Other"]'::jsonb,    true),
  ('highlight',       'default', 7, 'multiple', 'What did you enjoy most?',                    NULL, true,  false, '["The pizza","The people","The talks / program","The vibe"]'::jsonb,                    true),
  ('comments',        'default', 8, 'text',     'Anything else you''d like to share?',         NULL, false, false, '[]'::jsonb,                                                                              true)
ON CONFLICT (question_set, id) DO NOTHING;
