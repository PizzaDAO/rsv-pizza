-- City-level payment approval. Admin can approve a total amount for the city
-- before sending payment. Shows thumbs-up button becomes filled when approved.

ALTER TABLE parties ADD COLUMN IF NOT EXISTS payments_approved_usd numeric(10,2);
ALTER TABLE parties ADD COLUMN IF NOT EXISTS payments_approved_at timestamptz;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS payments_approved_by uuid REFERENCES auth.users(id);
