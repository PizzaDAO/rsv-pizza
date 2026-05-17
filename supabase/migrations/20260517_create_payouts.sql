-- ============================================
-- Host Payouts (arugula-38633)
-- ============================================
-- Reimbursement requests from hosts: upload photos -> OCR -> approve -> payout.
-- Three payout rails: Mercury debit card (admin-mediated), manual wire, USDC on Base.
-- All writes go through the backend (service_role bypasses RLS); anon/authenticated
-- never read these tables directly, so we REVOKE per the Feb 2026 security audit pattern.
-- ============================================

-- 1. Payouts table (one row per reimbursement request)
CREATE TABLE payouts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id              UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  host_user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- Amount tracking (always store ALL three: original, USD, and "final" after admin edits)
  original_amount       NUMERIC(12, 2) NOT NULL,
  original_currency     TEXT NOT NULL,
  exchange_rate         NUMERIC(18, 6) NOT NULL,  -- locked at submission time
  extracted_amount_usd  NUMERIC(12, 2) NOT NULL,  -- OCR sum, converted at submission
  final_amount_usd      NUMERIC(12, 2) NOT NULL,  -- after host manual override + admin edits
  -- Status: pending | approved | rejected | paid | failed
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','paid','failed')),
  -- Payout method: mercury_card | wire | usdc_base
  payout_method         TEXT NOT NULL
                          CHECK (payout_method IN ('mercury_card','wire','usdc_base')),
  -- Method-specific payout target (one of these populated based on method)
  payout_wallet_address TEXT,                 -- 0x... for usdc_base
  payout_bank_details   JSONB,                -- {accountHolder, routing, account, swift, iban, bankName, address, ...} for wire
  mercury_card_id       TEXT,                 -- Mercury card ID (if recorded — optional, may be null for fully-manual flow)
  mercury_card_last4    TEXT,                 -- Mercury card last 4 digits (shown to host)
  -- Notes
  host_notes            TEXT,
  admin_notes           TEXT,
  rejection_reason      TEXT,
  -- Approval / execution tracking
  reviewed_by           TEXT,                 -- admin email
  reviewed_at           TIMESTAMPTZ,
  paid_at               TIMESTAMPTZ,
  -- Method-specific receipt/proof
  transaction_hash      TEXT,                 -- Base tx hash for usdc_base
  wire_reference        TEXT,                 -- bank reference number for wire
  -- Metadata
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payouts_party_id     ON payouts (party_id);
CREATE INDEX idx_payouts_host_user_id ON payouts (host_user_id);
CREATE INDEX idx_payouts_status       ON payouts (status);
CREATE INDEX idx_payouts_created_at   ON payouts (created_at DESC);

-- 2. Payout documents (photos: pizza shot + receipt(s))
CREATE TABLE payout_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id       UUID NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('pizza','receipt')),
  url             TEXT NOT NULL,             -- Supabase Storage public URL
  file_name       TEXT NOT NULL,
  file_size       INTEGER NOT NULL,
  mime_type       TEXT NOT NULL,
  -- OCR results (only populated for kind='receipt')
  ocr_amount      NUMERIC(12, 2),
  ocr_currency    TEXT,
  ocr_confidence  NUMERIC(3, 2),             -- 0.00-1.00
  ocr_raw         JSONB,                     -- full OpenAI response for debugging
  ocr_error       TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payout_documents_payout_id ON payout_documents (payout_id);

-- 3. Payout audit log (mirrors party_status_audit pattern from pizzaiolo-97053)
CREATE TABLE payout_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id   UUID NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
  action      TEXT NOT NULL
                CHECK (action IN ('create','approve','reject','edit_amount','mark_paid','mark_failed','retry','cancel')),
  old_status  TEXT,
  new_status  TEXT,
  old_amount  NUMERIC(12, 2),
  new_amount  NUMERIC(12, 2),
  actor_email TEXT NOT NULL,
  actor_kind  TEXT NOT NULL CHECK (actor_kind IN ('admin','superadmin','payment_admin','host','system')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_payout_audit_payout_id  ON payout_audit (payout_id);
CREATE INDEX idx_payout_audit_created_at ON payout_audit (created_at DESC);

-- 4. Host payout preferences on users table
ALTER TABLE users ADD COLUMN preferred_payout_method TEXT
  CHECK (preferred_payout_method IN ('mercury_card','wire','usdc_base'));
ALTER TABLE users ADD COLUMN payout_wallet_address TEXT;
ALTER TABLE users ADD COLUMN payout_bank_details JSONB;
-- No stripe_cardholder_id needed — Mercury doesn't require per-host KYC enrollment.

-- 5. Permissions: per the Feb 2026 security audit, all writes go through the
-- backend (service_role bypasses RLS). anon/authenticated NEVER need to read
-- these tables directly. Audit log is service_role only.
REVOKE ALL ON payouts           FROM anon, authenticated;
REVOKE ALL ON payout_documents  FROM anon, authenticated;
REVOKE ALL ON payout_audit      FROM anon, authenticated;

ALTER TABLE payouts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_audit     ENABLE ROW LEVEL SECURITY;

-- 6. New users columns: backend reads via Prisma (service_role), so column-level
-- GRANTs to anon/authenticated are NOT needed here. Confirmed no frontend code
-- reads users.* directly via supabase-js — all user data flows through the
-- backend /api/user routes. If that changes, add GRANT SELECT.

-- 7. Deletion log triggers (matches existing pattern in 20260429_create_deletion_log.sql)
CREATE TRIGGER trg_deletion_log_payouts           BEFORE DELETE ON payouts          FOR EACH ROW EXECUTE FUNCTION log_deletion();
CREATE TRIGGER trg_deletion_log_payout_documents  BEFORE DELETE ON payout_documents FOR EACH ROW EXECUTE FUNCTION log_deletion();

-- 8. updated_at trigger for payouts
CREATE OR REPLACE FUNCTION update_payouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payouts_updated_at BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION update_payouts_updated_at();
