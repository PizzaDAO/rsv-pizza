-- panettone-58533: applied to prod via MCP on 2026-06-15; file is for repo record + drift guard.
CREATE TABLE IF NOT EXISTS party_telegram_hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  telegram_user_id bigint,
  username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, chat_id)
);
CREATE INDEX IF NOT EXISTS party_telegram_hosts_chat_id_idx ON party_telegram_hosts (chat_id);
