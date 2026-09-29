-- White-label Phase 2b: per-series host checklist defaults.
-- Existing checklist_defaults rows become the GLOBAL template (series_id = NULL),
-- which every party still falls back to. A series can define its own defaults by
-- inserting rows with its series_id; parties in that series seed from those
-- instead. Additive + backward compatible.

ALTER TABLE "checklist_defaults"
  ADD COLUMN "series_id" UUID REFERENCES "event_series"("id") ON DELETE CASCADE;

-- Relax the global name-unique so a series can reuse a global item name.
-- Uniqueness becomes per (series, name); NULL series collapses to a sentinel so
-- the global template keeps unique names.
ALTER TABLE "checklist_defaults" DROP CONSTRAINT IF EXISTS "checklist_defaults_name_key";

CREATE UNIQUE INDEX IF NOT EXISTS "checklist_defaults_series_name_key"
  ON "checklist_defaults" (COALESCE("series_id", '00000000-0000-0000-0000-000000000000'::uuid), "name");

CREATE INDEX IF NOT EXISTS "idx_checklist_defaults_series_id"
  ON "checklist_defaults" ("series_id");
