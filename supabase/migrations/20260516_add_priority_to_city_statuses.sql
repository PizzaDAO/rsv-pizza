-- Add priority flag to city_statuses (independent of status)
ALTER TABLE city_statuses ADD COLUMN priority boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_city_statuses_priority ON city_statuses(priority) WHERE priority = true;
