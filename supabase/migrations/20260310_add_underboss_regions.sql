-- Add regions array column for multi-region underboss support
ALTER TABLE underbosses ADD COLUMN regions text[] DEFAULT '{}';

-- Populate from existing single region
UPDATE underbosses SET regions = ARRAY[region];

-- Africa underbosses get all 3 sub-regions
UPDATE underbosses SET regions = ARRAY['west-africa', 'east-africa', 'south-africa']
WHERE region = 'africa';

ALTER TABLE underbosses ALTER COLUMN regions SET NOT NULL;
CREATE INDEX idx_underbosses_regions ON underbosses USING GIN (regions);

-- Migrate Africa events to west-africa (default, admins can reassign)
UPDATE parties SET region = 'west-africa' WHERE region = 'africa' AND event_type = 'gpp';
