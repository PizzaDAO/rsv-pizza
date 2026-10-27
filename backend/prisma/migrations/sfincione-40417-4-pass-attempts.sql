SET lock_timeout = '5s';
ALTER TABLE pizza_line_sync
  ADD COLUMN IF NOT EXISTS llm_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS llm_last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS vision_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vision_last_error_at timestamptz;
