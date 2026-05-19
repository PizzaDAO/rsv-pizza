-- marinara-67583: Outreach attempts log
-- Admin-only — explicitly revoke from anon/authenticated.
-- Backend reads/writes via service_role.

CREATE TABLE IF NOT EXISTS outreach_attempts (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  community_id        TEXT NOT NULL REFERENCES outreach_communities(id) ON DELETE CASCADE,
  channel             TEXT NOT NULL,                              -- 'twitter_dm' | 'email' | 'telegram'
  template_id         TEXT NOT NULL,                              -- 'v1_twitter' | 'v1_email' | 'v1_telegram'
  sent_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by             TEXT NOT NULL,                              -- admin email from req.userEmail
  status              TEXT NOT NULL DEFAULT 'sent',               -- 'sent' | 'replied' | 'declined' | 'converted' | 'bounced'
  converted_party_id  UUID REFERENCES parties(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT outreach_attempts_channel_check
    CHECK (channel IN ('twitter_dm', 'email', 'telegram')),
  CONSTRAINT outreach_attempts_status_check
    CHECK (status IN ('sent', 'replied', 'declined', 'converted', 'bounced'))
);

CREATE INDEX IF NOT EXISTS idx_outreach_attempts_community ON outreach_attempts(community_id);
CREATE INDEX IF NOT EXISTS idx_outreach_attempts_status    ON outreach_attempts(status);
CREATE INDEX IF NOT EXISTS idx_outreach_attempts_sent_at   ON outreach_attempts(sent_at DESC);

ALTER TABLE outreach_attempts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_outreach_attempts_updated_at ON outreach_attempts;
CREATE TRIGGER trg_outreach_attempts_updated_at
  BEFORE UPDATE ON outreach_attempts
  FOR EACH ROW
  EXECUTE FUNCTION set_outreach_communities_updated_at();

-- Admin-only — Supabase auto-grants on new public tables; revoke explicitly.
REVOKE ALL ON outreach_attempts FROM anon, authenticated;
