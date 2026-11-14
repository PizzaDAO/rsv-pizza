BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- hackathon-2-voting (plans/hackathon-platform.md §3, §11, §16, PR 7): public (People's Choice)
-- voting. Two NEW tables; nothing on an existing table changes.
--
-- Why a settings TABLE and not hackathons.voting_* columns (the plan's first sketch): Prisma
-- SELECTs every declared field, so a column added to the Hackathon model would 500 every
-- hackathon read (event page, host tab, judge queue, gallery, display) if the code deployed
-- before the column existed. A separate 1:1 table is only read by the new voting code, so the
-- blast radius of a mis-ordered deploy is the voting endpoints alone, and `hackathons` (a hot,
-- read-everywhere table) takes no ALTER / no ACCESS EXCLUSIVE lock. No row = voting off.
--
-- Purely additive, idempotent (CREATE ... IF NOT EXISTS; REVOKE is a no-op when nothing is
-- granted). The FKs take SHARE ROW EXCLUSIVE on hackathons / hackathon_submissions /
-- hackathon_tracks / "User" until COMMIT: keep the transaction short.
-- APPLY TO PROD BEFORE MERGING the Prisma models: backend/scripts/apply-hackathon-voting.cjs
-- (dry run by default; --apply runs this file's statements in one transaction and verifies).
-- Backend-owned (Prisma): RLS ENABLED with NO policies, and anon/authenticated hold nothing.
-- uuid PKs (no sequences); the runner still checks that no owned sequence is granted.
--
-- Same-hackathon integrity (as hackathon-1-core): a vote carries hackathon_id and points at its
-- submission and track through composite FKs (ref_id, hackathon_id) -> parent(id, hackathon_id).
--
-- Delete rules:
--   * CASCADE from the hackathon (a hard hackathon delete is only possible with no submissions,
--     so in practice no votes), from the submission (a draft / withdrawn project is deleted when
--     its last member leaves; its votes go with it), from the track (a track with entries can't
--     be deleted, see hackathon_submission_tracks; stale per-track votes go with the track), and
--     from the voter's "User" row (users are not hard-deleted in code).
-- Keep this file free of $$ blocks and of semicolons inside string literals: the runner strips
-- -- comments, then splits statements on semicolons.

-- Voting settings, 1:1 with hackathons. The window is [opens_at, closes_at): open while
-- enabled AND opens_at <= now() AND (closes_at IS NULL OR now() < closes_at). Manual open /
-- close set these timestamps (no separate state column, so there's one source of truth).
-- eligibility: 'registered' (approved RSVP) or 'checked_in' (default; §16 Q1). scope: one vote
-- per voter event-wide ('event') or one per track ('track').
CREATE TABLE IF NOT EXISTS hackathon_voting (
  hackathon_id uuid PRIMARY KEY REFERENCES hackathons(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  scope text NOT NULL DEFAULT 'event' CHECK (scope IN ('event', 'track')),
  eligibility text NOT NULL DEFAULT 'checked_in' CHECK (eligibility IN ('registered', 'checked_in')),
  opens_at timestamptz,
  closes_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hackathon_voting_window_check CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at)
);
ALTER TABLE hackathon_voting ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hackathon_voting FROM anon, authenticated;

-- One row per (hackathon, scope, voter): track_id NULL = the event-wide vote. Changing a vote
-- updates the row (allowed until the window closes). ip_hash = HMAC-SHA256 (hex) of the
-- normalized client IP under a server secret, per hackathon: for abuse review (counts per
-- bucket), never the raw IP, never shown to anyone.
CREATE TABLE IF NOT EXISTS hackathon_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hackathon_id uuid NOT NULL REFERENCES hackathons(id) ON DELETE CASCADE,
  track_id uuid,
  submission_id uuid NOT NULL,
  voter_user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  ip_hash text CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hackathon_votes_submission_id_hackathon_id_fkey FOREIGN KEY (submission_id, hackathon_id)
    REFERENCES hackathon_submissions(id, hackathon_id) ON DELETE CASCADE,
  CONSTRAINT hackathon_votes_track_id_hackathon_id_fkey FOREIGN KEY (track_id, hackathon_id)
    REFERENCES hackathon_tracks(id, hackathon_id) ON DELETE CASCADE
);
ALTER TABLE hackathon_votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hackathon_votes FROM anon, authenticated;
-- One vote per voter per scope (expression index: not expressible in Prisma, the route upserts
-- with ON CONFLICT on exactly this expression).
CREATE UNIQUE INDEX IF NOT EXISTS hackathon_votes_one_per_scope
  ON hackathon_votes(hackathon_id, (COALESCE(track_id, '00000000-0000-0000-0000-000000000000'::uuid)), voter_user_id);
CREATE INDEX IF NOT EXISTS hackathon_votes_hackathon_id_submission_id_idx ON hackathon_votes(hackathon_id, submission_id);
CREATE INDEX IF NOT EXISTS hackathon_votes_hackathon_id_ip_hash_idx ON hackathon_votes(hackathon_id, ip_hash);
CREATE INDEX IF NOT EXISTS hackathon_votes_track_id_idx ON hackathon_votes(track_id);
CREATE INDEX IF NOT EXISTS hackathon_votes_voter_user_id_idx ON hackathon_votes(voter_user_id);

COMMIT;
