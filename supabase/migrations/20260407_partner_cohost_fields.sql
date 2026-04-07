-- Add co-host profile fields to sponsor_users for auto co-hosting via event tags
ALTER TABLE sponsor_users ADD COLUMN IF NOT EXISTS co_host_name VARCHAR;
ALTER TABLE sponsor_users ADD COLUMN IF NOT EXISTS co_host_website VARCHAR;
ALTER TABLE sponsor_users ADD COLUMN IF NOT EXISTS co_host_twitter VARCHAR;
ALTER TABLE sponsor_users ADD COLUMN IF NOT EXISTS co_host_instagram VARCHAR;
ALTER TABLE sponsor_users ADD COLUMN IF NOT EXISTS co_host_avatar_url VARCHAR;
ALTER TABLE sponsor_users ADD COLUMN IF NOT EXISTS co_host_logo_url VARCHAR;
ALTER TABLE sponsor_users ADD COLUMN IF NOT EXISTS auto_co_host BOOLEAN DEFAULT false;
ALTER TABLE sponsor_users ADD COLUMN IF NOT EXISTS auto_sponsor BOOLEAN DEFAULT false;
