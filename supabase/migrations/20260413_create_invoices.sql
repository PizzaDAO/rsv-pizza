-- Create invoices table for partner invoice management
CREATE TABLE invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id        UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  sponsor_id      UUID NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,

  -- Invoice identification
  invoice_number  TEXT NOT NULL,
  view_token      TEXT UNIQUE NOT NULL,

  -- Bill-to (snapshot at invoice time)
  bill_to_company TEXT,
  bill_to_contact TEXT,
  bill_to_address TEXT,
  bill_to_email   TEXT NOT NULL,
  cc_emails       TEXT[],

  -- Line items (JSONB array)
  -- Each: { description: string, amount: number (cents) }
  line_items      JSONB NOT NULL DEFAULT '[]',

  -- Totals (all in cents)
  total           INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'usd',

  -- Payment info
  payment_terms   TEXT,
  payment_instructions TEXT,
  due_date        DATE,
  memo            TEXT,

  -- Status: draft, issued, viewed, paid, cancelled
  status          TEXT NOT NULL DEFAULT 'draft',

  -- Payment tracking
  paid_at         TIMESTAMPTZ,
  paid_amount     INTEGER,
  payment_method  TEXT,
  payment_ref     TEXT,

  -- Email tracking
  sent_at         TIMESTAMPTZ,
  viewed_at       TIMESTAMPTZ,

  -- Extra document attachments (URLs)
  attachments     JSONB DEFAULT '[]',

  -- Metadata
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_party_id ON invoices(party_id);
CREATE INDEX idx_invoices_sponsor_id ON invoices(sponsor_id);
CREATE INDEX idx_invoices_view_token ON invoices(view_token);
CREATE INDEX idx_invoices_status ON invoices(party_id, status);

-- Prevent duplicate invoice numbers per party (only for active invoices)
CREATE UNIQUE INDEX idx_invoices_unique_number
  ON invoices(party_id, invoice_number)
  WHERE status NOT IN ('cancelled');

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
