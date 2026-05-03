ALTER TABLE parties ADD COLUMN turtle_roles_enabled BOOLEAN NOT NULL DEFAULT false;
GRANT SELECT (turtle_roles_enabled) ON parties TO anon, authenticated;
