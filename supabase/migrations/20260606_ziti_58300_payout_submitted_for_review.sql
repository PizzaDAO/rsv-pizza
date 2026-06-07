-- ziti-58300: rolling per-(party,host) reimbursements.
-- Host explicitly marks their reimbursement "submitted for review" (tracked by a
-- timestamp, not a status change). Additive + nullable; already applied to prod.
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS submitted_for_review_at timestamptz;
