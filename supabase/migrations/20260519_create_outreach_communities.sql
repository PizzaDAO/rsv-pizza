-- stagioni-29104: Outreach community staging table
-- Admin-only — no anon/authenticated GRANTs. Backend reads via service_role.
-- Mirrors the sponsor_users access pattern from 20260403_sponsor_dashboard.sql.

CREATE TABLE outreach_communities (
  id              TEXT PRIMARY KEY DEFAULT (
    -- cuid-compatible: matches the User.id default (cuid())
    -- Prisma will write its own cuid() values when inserts come via the client.
    -- For raw-SQL inserts from scraper scripts, generate the cuid in JS.
    gen_random_uuid()::text
  ),
  city            TEXT NOT NULL,
  country         TEXT,
  community_name  TEXT NOT NULL,
  source          TEXT NOT NULL,            -- 'luma' | 'meetup' | 'curated' | 'twitter'
  contact_handle  TEXT,
  contact_url     TEXT NOT NULL,
  contact_email   TEXT,
  follower_count  INT,
  activity_score  NUMERIC(10, 4),
  priority        TEXT,                     -- 'high' | 'medium' | 'low' | null
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT outreach_communities_source_check
    CHECK (source IN ('luma', 'meetup', 'curated', 'twitter')),
  CONSTRAINT outreach_communities_priority_check
    CHECK (priority IS NULL OR priority IN ('high', 'medium', 'low'))
);

CREATE UNIQUE INDEX idx_outreach_communities_source_url
  ON outreach_communities (source, contact_url);

CREATE INDEX idx_outreach_communities_city_lower
  ON outreach_communities (lower(city));

CREATE INDEX idx_outreach_communities_priority
  ON outreach_communities (priority) WHERE priority IS NOT NULL;

-- Enable RLS but add NO permissive policies — service_role bypasses RLS,
-- and anon/authenticated have no GRANT so they cannot SELECT.
ALTER TABLE outreach_communities ENABLE ROW LEVEL SECURITY;

-- Trigger to maintain updated_at on every UPDATE
CREATE OR REPLACE FUNCTION set_outreach_communities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_outreach_communities_updated_at
  BEFORE UPDATE ON outreach_communities
  FOR EACH ROW
  EXECUTE FUNCTION set_outreach_communities_updated_at();

-- NOTE: deliberately no GRANT SELECT to anon/authenticated.
-- This table is admin-only. marinara-67583's /underboss/outreach route
-- will read it via service_role-key on the backend.
--
-- Supabase grants ALL privileges to anon/authenticated by default on every
-- new table in the public schema. Revoke them explicitly so the
-- role_table_grants view shows no rows for these roles.
REVOKE ALL ON outreach_communities FROM anon;
REVOKE ALL ON outreach_communities FROM authenticated;
