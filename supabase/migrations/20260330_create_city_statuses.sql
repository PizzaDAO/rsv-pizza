-- City status tracking for Underboss dashboard
CREATE TABLE city_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'todo',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE city_statuses ENABLE ROW LEVEL SECURITY;
