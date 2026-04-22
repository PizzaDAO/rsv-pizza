-- quiz_enabled on parties
ALTER TABLE parties ADD COLUMN IF NOT EXISTS quiz_enabled BOOLEAN DEFAULT false;
GRANT SELECT (quiz_enabled) ON parties TO anon, authenticated;

-- Quiz question templates (global, per partner)
CREATE TABLE quiz_question_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_user_id UUID NOT NULL REFERENCES sponsor_users(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options JSONB DEFAULT '[]',
  correct_index INT NOT NULL,
  explanation TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quiz_question_templates_sponsor ON quiz_question_templates(sponsor_user_id);

-- Quiz questions (per event, copied from templates or created by host)
CREATE TABLE quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  sponsor_id UUID REFERENCES sponsors(id) ON DELETE SET NULL,
  template_id UUID REFERENCES quiz_question_templates(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  options JSONB DEFAULT '[]',
  correct_index INT NOT NULL,
  explanation TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quiz_questions_party ON quiz_questions(party_id);

-- Quiz answers
CREATE TABLE quiz_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id UUID NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  guest_id UUID NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  selected_index INT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(question_id, guest_id)
);

CREATE INDEX idx_quiz_answers_question ON quiz_answers(question_id);
CREATE INDEX idx_quiz_answers_guest ON quiz_answers(guest_id);

-- RLS
ALTER TABLE quiz_question_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_answers ENABLE ROW LEVEL SECURITY;
