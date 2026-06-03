-- brie-92108: allow action='unreject' on payout_audit
ALTER TABLE payout_audit DROP CONSTRAINT payout_audit_action_check;
ALTER TABLE payout_audit ADD CONSTRAINT payout_audit_action_check
  CHECK (action = ANY (ARRAY['create','approve','unapprove','reject','unreject',
    'edit_amount','edit_documents','edit_recipient','mark_paid','unmark_paid',
    'mark_queued','unmark_queued','mark_failed','flag_ready','bulk_execute',
    'retry','cancel']));
