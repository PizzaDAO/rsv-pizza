-- Create mous table for partner/sponsor MOU (Memorandum of Understanding) management with recipient e-sign
CREATE TABLE mous (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id        UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  sponsor_id      UUID NOT NULL REFERENCES sponsors(id) ON DELETE CASCADE,

  -- MOU identification
  mou_number      TEXT NOT NULL,
  view_token      TEXT UNIQUE NOT NULL,

  -- Counterparty (snapshot at MOU time)
  counterparty_company TEXT,
  counterparty_contact TEXT,
  counterparty_email   TEXT NOT NULL,
  cc_emails       TEXT[],

  -- Content
  title           TEXT NOT NULL,
  body_markdown   TEXT NOT NULL,
  effective_date  DATE,
  term_text       TEXT,

  -- Status: draft, issued, viewed, signed, cancelled
  status          TEXT NOT NULL DEFAULT 'draft',

  -- Recipient signature
  signer_name     TEXT,
  signer_email    TEXT,
  signed_at       TIMESTAMPTZ,
  signer_ip       TEXT,

  -- Issuer (host) record
  issuer_name     TEXT,
  issuer_signed_at TIMESTAMPTZ,

  -- Email tracking
  sent_at         TIMESTAMPTZ,
  viewed_at       TIMESTAMPTZ,

  -- Extra document attachments (URLs)
  attachments     JSONB DEFAULT '[]',

  -- Metadata
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mous_party_id ON mous(party_id);
CREATE INDEX idx_mous_sponsor_id ON mous(sponsor_id);
CREATE INDEX idx_mous_view_token ON mous(view_token);
CREATE INDEX idx_mous_status ON mous(party_id, status);

-- Prevent duplicate MOU numbers per party (only for active MOUs)
CREATE UNIQUE INDEX idx_mous_unique_number
  ON mous(party_id, mou_number)
  WHERE status NOT IN ('cancelled');

ALTER TABLE mous ENABLE ROW LEVEL SECURITY;
