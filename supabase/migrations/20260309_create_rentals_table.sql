-- Phase 1: Create rentals table
CREATE TABLE rentals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,

  -- Identity
  name TEXT NOT NULL,
  description TEXT,

  -- Shape
  shape_type TEXT NOT NULL DEFAULT 'rectangle',
  color TEXT NOT NULL DEFAULT '#ff393a',
  border_color TEXT DEFAULT '#ffffff',

  -- Position (percentage-based 0-100, matching display pins)
  x FLOAT NOT NULL DEFAULT 50,
  y FLOAT NOT NULL DEFAULT 50,
  width FLOAT NOT NULL DEFAULT 10,
  height FLOAT NOT NULL DEFAULT 10,
  rotation FLOAT DEFAULT 0,

  -- Rental details
  price DECIMAL(10, 2),
  price_unit TEXT DEFAULT 'flat',
  capacity INT,
  status TEXT DEFAULT 'available',

  -- Booking info
  booked_by TEXT,
  booked_email TEXT,
  booked_notes TEXT,

  -- Display options
  show_label BOOLEAN DEFAULT TRUE,
  show_on_display BOOLEAN DEFAULT TRUE,
  opacity FLOAT DEFAULT 0.3,

  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rentals_party ON rentals(party_id);

-- RLS: Backend uses service_role (bypasses RLS), but enable for safety
ALTER TABLE rentals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view displayable rentals" ON rentals FOR SELECT USING (show_on_display = true);
CREATE POLICY "Service role full access to rentals" ON rentals FOR ALL USING (true) WITH CHECK (true);
