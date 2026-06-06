-- tonda-58293: durable per-city Telegram group chat store.
-- Previously the city -> group chat_id mapping lived ONLY in a Google Sheet
-- and was fetched client-side; supergroup migrations (Telegram's
-- migrate_to_chat_id) were never persisted, so broadcasts silently drifted.
-- Keyed by city_key (lower(trim(city)), same convention as city_statuses).
-- Idempotent so it is safe to re-run.

CREATE TABLE IF NOT EXISTS city_telegram_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_key text NOT NULL,
  chat_id bigint,
  chat_url varchar,
  title text,
  is_supergroup boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual',
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS city_telegram_groups_city_key_key
  ON city_telegram_groups (city_key);

-- tonda-58293 follow-up: restore the country / underboss / region metadata
-- that the legacy Google Sheet supplied so the broadcast modal can render
-- those columns and the region filter again.

ALTER TABLE city_telegram_groups ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE city_telegram_groups ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE city_telegram_groups ADD COLUMN IF NOT EXISTS underboss text;
