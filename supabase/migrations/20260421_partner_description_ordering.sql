ALTER TABLE sponsor_users ADD COLUMN IF NOT EXISTS description_sort_order INT NOT NULL DEFAULT 0;
