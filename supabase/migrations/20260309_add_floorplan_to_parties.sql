-- Phase 0: Add floorplan columns to parties table
ALTER TABLE parties ADD COLUMN IF NOT EXISTS floorplan_url TEXT;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS floorplan_data JSONB DEFAULT '{}';
