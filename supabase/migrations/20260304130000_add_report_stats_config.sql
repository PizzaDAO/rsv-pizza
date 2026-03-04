ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS report_stats_config JSONB;
