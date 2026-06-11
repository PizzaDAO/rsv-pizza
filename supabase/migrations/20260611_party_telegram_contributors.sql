CREATE TABLE IF NOT EXISTS party_telegram_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  telegram_user_id bigint,
  username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_telegram_contributors_party_chat_unique UNIQUE (party_id, chat_id)
);
CREATE INDEX IF NOT EXISTS party_telegram_contributors_chat_id_idx ON party_telegram_contributors (chat_id);
