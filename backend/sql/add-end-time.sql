-- Add end_time and timezone fields to parties table
ALTER TABLE parties ADD COLUMN IF NOT EXISTS end_time TIMESTAMP WITH TIME ZONE;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS timezone VARCHAR(100);

COMMENT ON COLUMN parties.end_time IS 'Party end time';
COMMENT ON COLUMN parties.timezone IS 'IANA timezone identifier (e.g., America/New_York)';
