-- guanciale-58491: audit log for host-DM / city-group Telegram broadcasts.
-- The id doubles as the client-minted broadcastId double-send guard:
-- the host-broadcast endpoint short-circuits if a row with that id exists.
-- Apply manually to prod BEFORE merging (no Prisma auto-migrate in this repo).

CREATE TABLE IF NOT EXISTS telegram_broadcast_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- caller identity, from req.underboss
  actor_email    text NOT NULL,
  -- 'admin' | 'underboss'
  actor_kind     text NOT NULL,
  -- logical channel, e.g. 'host_dm'
  channel        text NOT NULL,
  message        text NOT NULL,
  -- how many recipients the broadcast targeted
  audience_count integer NOT NULL,
  sent_count     integer NOT NULL,
  failed_count   integer NOT NULL,
  -- how many 'not connected' hosts got the message text via email fallback
  emailed_count  integer NOT NULL DEFAULT 0,
  -- per-recipient results blob (same shape as the endpoint response)
  results        jsonb NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_broadcast_log_created_at_idx
  ON telegram_broadcast_log (created_at DESC);
