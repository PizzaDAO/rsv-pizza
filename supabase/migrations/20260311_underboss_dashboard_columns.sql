-- Underboss dashboard improvements: host status, approval, and host tags columns
ALTER TABLE parties ADD COLUMN IF NOT EXISTS host_status text;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS underboss_approved boolean DEFAULT false;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS host_tags jsonb DEFAULT '[]'::jsonb;
