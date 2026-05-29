-- culatello-92103: add 'unmark_paid' to payout_audit action CHECK constraint.
--
-- Adds the audit action for the new POST /api/admin/payouts/:id/revert-paid
-- endpoint, which flips a paid payout back to 'approved' so the admin can
-- re-execute (or re-mark-paid out-of-band) after correcting an error. Mirrors
-- the existing 'unapprove' action (approved -> pending).
--
-- The constraint as it stands in prod allows:
--   create, approve, unapprove, reject, edit_amount, edit_documents,
--   edit_recipient, mark_paid, mark_failed, flag_ready, bulk_execute, retry,
--   cancel
-- This drops + recreates with 'unmark_paid' appended.

ALTER TABLE payout_audit DROP CONSTRAINT IF EXISTS payout_audit_action_check;
ALTER TABLE payout_audit ADD CONSTRAINT payout_audit_action_check
  CHECK (action = ANY (ARRAY[
    'create'::text,
    'approve'::text,
    'unapprove'::text,
    'reject'::text,
    'edit_amount'::text,
    'edit_documents'::text,
    'edit_recipient'::text,
    'mark_paid'::text,
    'unmark_paid'::text,
    'mark_failed'::text,
    'flag_ready'::text,
    'bulk_execute'::text,
    'retry'::text,
    'cancel'::text
  ]));
