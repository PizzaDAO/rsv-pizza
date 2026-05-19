-- ============================================
-- Reimbursement cap + appeal (arugula-38633 v2)
-- ============================================
-- Adds three columns to `parties` for the per-event reimbursement cap feature:
--   * reimbursement_cap_usd          — underboss-validated cap shown to hosts
--   * reimbursement_cap_appeal_note  — free-text appeal from the host
--   * reimbursement_cap_appealed_at  — timestamp the appeal was submitted
--
-- Until an underboss validates or overrides, reimbursement_cap_usd stays NULL
-- and the host-side banner does not render.
-- ============================================

ALTER TABLE parties ADD COLUMN reimbursement_cap_usd NUMERIC(10, 2);
ALTER TABLE parties ADD COLUMN reimbursement_cap_appeal_note TEXT;
ALTER TABLE parties ADD COLUMN reimbursement_cap_appealed_at TIMESTAMPTZ;

-- Column-level SELECT grants — the Feb 2026 security audit revoked table-level
-- SELECT on `parties`; new columns require explicit grants or anon/authenticated
-- frontend queries return 42501 (permission denied for table parties).
GRANT SELECT (reimbursement_cap_usd, reimbursement_cap_appeal_note, reimbursement_cap_appealed_at)
  ON parties TO anon, authenticated;
