-- suppli-58533: per-type Telegram authz — photo-only contributors.
-- A non-host user who taps a publicly broadcast `submit_<token>` group link
-- becomes a photo-only contributor (event photos allowed; receipts/attendance/
-- wallet stay host-only). Verified hosts use parties.host_telegram_chat_id.
--
-- This table was ALREADY applied to prod separately; this file is kept for
-- history only. It is a flat manual .sql (the repo's manual-migration pattern,
-- e.g. panzerotti-58527-host-survey.sql) so it is NOT auto-applied by
-- `prisma migrate deploy` (deploy only runs `prisma generate && tsc`).
-- Idempotent so it is safe to re-run.

CREATE TABLE IF NOT EXISTS party_telegram_contributors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id         uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  chat_id          bigint NOT NULL,
  telegram_user_id bigint,
  username         text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, chat_id)
);

CREATE INDEX IF NOT EXISTS party_telegram_contributors_chat_id_idx
  ON party_telegram_contributors (chat_id);
