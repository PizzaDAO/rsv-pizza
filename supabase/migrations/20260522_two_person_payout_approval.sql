-- Two-person payout approval: add pre_approved intermediate status.
-- First admin approves → pre_approved (sets first_approved_by/first_approved_at).
-- Second (different) admin approves → approved (ready for execution).

-- Add first-approver tracking columns
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS first_approved_by TEXT,
  ADD COLUMN IF NOT EXISTS first_approved_at TIMESTAMPTZ;

-- Expand status CHECK to include 'pre_approved'
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_status_check;
ALTER TABLE payouts ADD CONSTRAINT payouts_status_check
  CHECK (status IN ('pending','pre_approved','approved','rejected','paid','failed'));

-- Expand audit action CHECK to include 'first_approve' and 'second_approve'
ALTER TABLE payout_audit DROP CONSTRAINT IF EXISTS payout_audit_action_check;
ALTER TABLE payout_audit ADD CONSTRAINT payout_audit_action_check
  CHECK (action IN ('create','approve','first_approve','second_approve','reject','edit_amount','mark_paid','mark_failed','retry','cancel','bulk_execute'));
