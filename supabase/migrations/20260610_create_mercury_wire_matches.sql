-- Create mercury_wire_matches table for auto-reconciling incoming wire payments
-- against open invoices via the Mercury API.
CREATE TABLE mercury_wire_matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mercury_txn_id  TEXT UNIQUE NOT NULL,
  invoice_id      UUID NULL REFERENCES invoices(id) ON DELETE SET NULL,

  amount          INTEGER NOT NULL,   -- cents
  currency        TEXT,
  memo            TEXT,
  counterparty    TEXT,
  posted_at       TIMESTAMPTZ,

  -- status: auto_paid | needs_review | unmatched
  status          TEXT NOT NULL DEFAULT 'unmatched',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mercury_wire_matches_status ON mercury_wire_matches(status);
CREATE INDEX idx_mercury_wire_matches_invoice_id ON mercury_wire_matches(invoice_id);
