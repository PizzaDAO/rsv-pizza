-- Add budget fields to parties table
ALTER TABLE parties
ADD COLUMN IF NOT EXISTS budget_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS budget_total DECIMAL(10, 2);

-- Create budget_items table
CREATE TABLE IF NOT EXISTS budget_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  category VARCHAR NOT NULL,
  cost DECIMAL(10, 2) NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'pending',
  point_person VARCHAR,
  notes TEXT,
  receipt_url VARCHAR,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on party_id and category for efficient queries
CREATE INDEX IF NOT EXISTS idx_budget_items_party_category
ON budget_items(party_id, category);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_budget_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS budget_items_updated_at ON budget_items;
CREATE TRIGGER budget_items_updated_at
BEFORE UPDATE ON budget_items
FOR EACH ROW
EXECUTE FUNCTION update_budget_items_updated_at();
