ALTER TABLE parties ADD COLUMN telegram_group VARCHAR;
GRANT SELECT (telegram_group) ON parties TO anon, authenticated;
