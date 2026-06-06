-- tonda-58293 Phase 2: raw inbound Telegram group captures.
-- The bot learns a group's chat_id from updates it receives (primarily
-- my_chat_member, plus group messages). Every group/supergroup we see is
-- upserted here before being resolved to a city. Auto-matched captures are
-- also written through to city_telegram_groups; unmatched ones stay here as
-- orphans awaiting manual assignment in the /underboss UI.
-- Kept separate from city_telegram_groups so the resolved map stays clean.

CREATE TABLE IF NOT EXISTS telegram_group_captures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Telegram group/supergroup chat id. Supergroups are large negatives (-100...).
  chat_id           BIGINT NOT NULL,
  title             TEXT,
  -- group | supergroup
  chat_type         TEXT,
  -- null = pending manual assignment
  assigned_city_key TEXT,
  auto_matched      BOOLEAN NOT NULL DEFAULT false,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS telegram_group_captures_chat_id_key
  ON telegram_group_captures (chat_id);
