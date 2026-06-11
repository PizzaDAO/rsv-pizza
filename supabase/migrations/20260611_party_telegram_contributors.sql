-- suppli-58533: per-type Telegram host authz — non-host "contributors" that a
-- city group has authorized to submit on the host's behalf.
--
-- The table already exists in production (it was created out-of-band). This
-- file exists for migration HISTORY and the schema-drift CI check
-- (scripts/check-schema-drift.js), which expects supabase/migrations/ to be the
-- source of truth — NOT backend/prisma/migrations/. Hence the idempotent
-- IF NOT EXISTS guards: re-applying against prod is a no-op.

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
