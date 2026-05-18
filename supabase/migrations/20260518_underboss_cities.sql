-- mozzarella-25815: Scope underboss access to specific cities
-- Adds a cities array column to underbosses so an UB can be scoped by
-- region(s), city(ies), or both. City keys use lower(trim(city_name)) — same
-- format as city_statuses.city_key — but here we store the original (case-
-- preserved) value from the GPP cities sheet so the backend can match against
-- the canonical "Global Pizza Party {City}" event name regex.

ALTER TABLE underbosses
  ADD COLUMN IF NOT EXISTS cities TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_underbosses_cities ON underbosses USING GIN (cities);
