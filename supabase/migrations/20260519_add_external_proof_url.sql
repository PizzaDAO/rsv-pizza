-- ============================================
-- External payment proof URL on payouts (arugula-38633 v2 follow-up)
-- ============================================
-- Adds a single nullable TEXT column for the "Record External Payment" admin
-- flow. When an admin records a payment that happened OUTSIDE the system
-- (Venmo, bank transfer, etc.), they can attach a transaction URL OR a link
-- to an uploaded proof file.
--
-- Presence of `external_proof_url` + admin_notes starting with
-- "External payment recorded." is the canonical signal that a payout row
-- represents an out-of-band payment. No separate boolean flag.
--
-- No GRANTs needed: payouts is fully revoked from anon/authenticated per the
-- Feb 2026 security audit; all access is backend-only via service_role.
-- ============================================

ALTER TABLE payouts ADD COLUMN external_proof_url TEXT;
