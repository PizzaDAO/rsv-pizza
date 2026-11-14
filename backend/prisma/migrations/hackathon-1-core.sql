BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- hackathon-1-core (plans/hackathon-platform.md, PR 1): every MVP hackathon table.
-- Schema only: no code reads these tables yet. Purely additive (new tables + their indexes; the
-- only touch on existing tables is FK references to parties / "User" / guests).
-- Idempotent (CREATE ... IF NOT EXISTS; REVOKE is a no-op when nothing is granted).
-- APPLY TO PROD BEFORE MERGING the Prisma models: backend/scripts/apply-hackathon-schema.cjs
-- (dry run by default; --apply runs this file's statements in one transaction and verifies).
-- Backend-owned (Prisma): RLS ENABLED with NO policies, and anon/authenticated hold nothing.
-- All PKs are uuid (no sequences); the runner still checks that no owned sequence is granted.
-- Voting (hackathon_votes + hackathons.voting_* columns) is hackathon-2-voting.sql, PR 7.
-- The private storage bucket `hackathon-media` is created in the Supabase dashboard.
-- Keep this file free of $$ blocks and of semicolons inside string literals: the runner strips
-- -- comments, then splits statements on semicolons.

-- One per party. A row means the app has been enabled; disabled_at set = hidden (soft disable).
CREATE TABLE IF NOT EXISTS hackathons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL UNIQUE REFERENCES parties(id) ON DELETE CASCADE,
  rules text CHECK (rules IS NULL OR length(rules) <= 20000),
  submissions_open_at timestamptz,
  submission_deadline timestamptz,
  team_min_size int NOT NULL DEFAULT 1 CHECK (team_min_size >= 1),
  team_max_size int NOT NULL DEFAULT 5 CHECK (team_max_size >= team_min_size AND team_max_size <= 20),
  max_tracks_per_submission int NOT NULL DEFAULT 1 CHECK (max_tracks_per_submission BETWEEN 1 AND 20),
  eligibility text NOT NULL DEFAULT 'registered' CHECK (eligibility IN ('registered', 'checked_in')),
  blind_judging boolean NOT NULL DEFAULT false,
  judging_status text NOT NULL DEFAULT 'not_started' CHECK (judging_status IN ('not_started', 'open', 'closed')),
  published_at timestamptz,
  gallery_visibility text NOT NULL DEFAULT 'after_reveal'
    CHECK (gallery_visibility IN ('hidden', 'after_deadline', 'after_reveal')),
  results_revealed_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hackathons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hackathons FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS hackathon_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hackathon_id uuid NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  sponsor_name text CHECK (sponsor_name IS NULL OR length(sponsor_name) <= 120),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hackathon_tracks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hackathon_tracks FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS hackathon_tracks_hackathon_id_sort_order_idx ON hackathon_tracks(hackathon_id, sort_order);

-- track_id NULL = an overall prize. kind 'peoples_choice' is ranked from the vote tally (PR 7).
CREATE TABLE IF NOT EXISTS hackathon_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hackathon_id uuid NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  track_id uuid REFERENCES hackathon_tracks(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  rank int CHECK (rank IS NULL OR rank >= 1),
  amount_text text CHECK (amount_text IS NULL OR length(amount_text) <= 120),
  amount_value numeric(20, 6) CHECK (amount_value IS NULL OR amount_value >= 0),
  currency text CHECK (currency IS NULL OR length(currency) <= 16),
  quantity int NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 100),
  kind text NOT NULL DEFAULT 'judged' CHECK (kind IN ('judged', 'peoples_choice')),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hackathon_prizes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hackathon_prizes FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS hackathon_prizes_hackathon_id_sort_order_idx ON hackathon_prizes(hackathon_id, sort_order);
CREATE INDEX IF NOT EXISTS hackathon_prizes_track_id_idx ON hackathon_prizes(track_id);

-- Rubric. Per-judge total = 100 * sum(weight * score / max_score) / sum(weight).
CREATE TABLE IF NOT EXISTS hackathon_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hackathon_id uuid NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR length(description) <= 1000),
  weight int NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 10),
  max_score int NOT NULL DEFAULT 5 CHECK (max_score BETWEEN 1 AND 10),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hackathon_criteria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hackathon_criteria FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS hackathon_criteria_hackathon_id_sort_order_idx ON hackathon_criteria(hackathon_id, sort_order);

-- invite_code: 10-char base32 from crypto.randomBytes (generated by the backend).
CREATE TABLE IF NOT EXISTS hackathon_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hackathon_id uuid NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  invite_code text NOT NULL UNIQUE CHECK (length(invite_code) BETWEEN 8 AND 32),
  created_by_user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hackathon_teams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hackathon_teams FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS hackathon_teams_hackathon_id_idx ON hackathon_teams(hackathon_id);

-- hackathon_id is denormalized so UNIQUE (hackathon_id, user_id) enforces one team per person
-- per event. show_on_gallery: per-member opt-out of name + avatar on public pages.
CREATE TABLE IF NOT EXISTS hackathon_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES hackathon_teams(id) ON DELETE CASCADE,
  hackathon_id uuid NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES guests(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('captain', 'member')),
  show_on_gallery boolean NOT NULL DEFAULT true,
  joined_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hackathon_team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hackathon_team_members FROM anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS hackathon_team_members_hackathon_id_user_id_key ON hackathon_team_members(hackathon_id, user_id);
CREATE INDEX IF NOT EXISTS hackathon_team_members_team_id_idx ON hackathon_team_members(team_id);
CREATE INDEX IF NOT EXISTS hackathon_team_members_user_id_idx ON hackathon_team_members(user_id);
CREATE INDEX IF NOT EXISTS hackathon_team_members_guest_id_idx ON hackathon_team_members(guest_id);

-- One project per team. cover_path / screenshot_paths are object paths in the private
-- `hackathon-media` bucket, never URLs.
CREATE TABLE IF NOT EXISTS hackathon_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hackathon_id uuid NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  team_id uuid NOT NULL UNIQUE REFERENCES hackathon_teams(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  slug text NOT NULL CHECK (length(slug) BETWEEN 1 AND 100),
  tagline text CHECK (tagline IS NULL OR length(tagline) <= 140),
  description text CHECK (description IS NULL OR length(description) <= 10000),
  repo_url text CHECK (repo_url IS NULL OR length(repo_url) <= 500),
  demo_video_url text CHECK (demo_video_url IS NULL OR length(demo_video_url) <= 500),
  deck_url text CHECK (deck_url IS NULL OR length(deck_url) <= 500),
  live_url text CHECK (live_url IS NULL OR length(live_url) <= 500),
  cover_path text CHECK (cover_path IS NULL OR length(cover_path) <= 500),
  screenshot_paths text[] NOT NULL DEFAULT '{}' CHECK (cardinality(screenshot_paths) <= 6),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'disqualified', 'withdrawn')),
  submitted_at timestamptz,
  disqualified_reason text CHECK (disqualified_reason IS NULL OR length(disqualified_reason) <= 1000),
  table_number text CHECK (table_number IS NULL OR length(table_number) <= 20),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hackathon_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hackathon_submissions FROM anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS hackathon_submissions_hackathon_id_slug_key ON hackathon_submissions(hackathon_id, slug);
CREATE INDEX IF NOT EXISTS hackathon_submissions_hackathon_id_status_idx ON hackathon_submissions(hackathon_id, status);

CREATE TABLE IF NOT EXISTS hackathon_submission_tracks (
  submission_id uuid NOT NULL REFERENCES hackathon_submissions(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES hackathon_tracks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (submission_id, track_id)
);
ALTER TABLE hackathon_submission_tracks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hackathon_submission_tracks FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS hackathon_submission_tracks_track_id_idx ON hackathon_submission_tracks(track_id);

-- Judges are matched by JWT email (stored lowercased). track_ids empty = all tracks.
CREATE TABLE IF NOT EXISTS hackathon_judges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hackathon_id uuid NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 320),
  name text CHECK (name IS NULL OR length(name) <= 120),
  user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  track_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  invited_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hackathon_judges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hackathon_judges FROM anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS hackathon_judges_hackathon_id_email_key ON hackathon_judges(hackathon_id, email);
CREATE INDEX IF NOT EXISTS hackathon_judges_email_idx ON hackathon_judges(email);
CREATE INDEX IF NOT EXISTS hackathon_judges_user_id_idx ON hackathon_judges(user_id);

-- criterion_scores: {criterionId: int}, validated against the rubric on write. total: weighted,
-- normalized to 0-100, computed on write. team_feedback is shown to the team after the reveal
-- when the judge wrote any (later phase), private_comment is hosts-only.
CREATE TABLE IF NOT EXISTS hackathon_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  judge_id uuid NOT NULL REFERENCES hackathon_judges(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES hackathon_submissions(id) ON DELETE CASCADE,
  criterion_scores jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(criterion_scores) = 'object'),
  total numeric(6, 2) NOT NULL CHECK (total >= 0 AND total <= 100),
  private_comment text CHECK (private_comment IS NULL OR length(private_comment) <= 2000),
  team_feedback text CHECK (team_feedback IS NULL OR length(team_feedback) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hackathon_scores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hackathon_scores FROM anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS hackathon_scores_judge_id_submission_id_key ON hackathon_scores(judge_id, submission_id);
CREATE INDEX IF NOT EXISTS hackathon_scores_submission_id_idx ON hackathon_scores(submission_id);

-- Winners + payout status tracking only (no money moves, no tax/KYC).
CREATE TABLE IF NOT EXISTS hackathon_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prize_id uuid NOT NULL REFERENCES hackathon_prizes(id) ON DELETE CASCADE,
  submission_id uuid NOT NULL REFERENCES hackathon_submissions(id) ON DELETE CASCADE,
  place int CHECK (place IS NULL OR place >= 1),
  awarded_at timestamptz NOT NULL DEFAULT now(),
  awarded_by text,
  payout_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payout_status IN ('unpaid', 'pending', 'paid', 'not_applicable')),
  recipient_user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  recipient_wallet text CHECK (recipient_wallet IS NULL OR length(recipient_wallet) <= 200),
  payout_reference text CHECK (payout_reference IS NULL OR length(payout_reference) <= 500),
  paid_at timestamptz,
  payout_notes text CHECK (payout_notes IS NULL OR length(payout_notes) <= 2000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE hackathon_awards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hackathon_awards FROM anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS hackathon_awards_prize_id_submission_id_key ON hackathon_awards(prize_id, submission_id);
CREATE INDEX IF NOT EXISTS hackathon_awards_submission_id_idx ON hackathon_awards(submission_id);
CREATE INDEX IF NOT EXISTS hackathon_awards_recipient_user_id_idx ON hackathon_awards(recipient_user_id);

COMMIT;
