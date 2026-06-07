-- ziti-58300: host "Submit for review" toggle on the rolling per-(party,host)
-- reimbursement record. Tracked as a separate timestamp, NOT a status change
-- (status stays 'pending' while rolling). Idempotent so it's safe to re-run.
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS submitted_for_review_at timestamptz;
