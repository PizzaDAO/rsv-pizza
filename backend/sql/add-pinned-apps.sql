ALTER TABLE parties ADD COLUMN IF NOT EXISTS pinned_apps jsonb DEFAULT '[]'::jsonb;
