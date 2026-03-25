-- Create shipping_coordinators table (mirrors underbosses table structure)
CREATE TABLE shipping_coordinators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  regions TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_shipping_coordinators_email ON shipping_coordinators (LOWER(email));
CREATE INDEX idx_shipping_coordinators_regions ON shipping_coordinators USING GIN (regions);
