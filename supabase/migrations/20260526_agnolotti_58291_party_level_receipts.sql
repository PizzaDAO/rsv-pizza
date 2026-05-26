-- agnolotti-58291: receipts become party-level. payout_id stays as an optional
-- association so we know which submission a receipt was uploaded with; party_id
-- is the canonical owner. With soft-withdraw + SET NULL on payout_id, receipts
-- survive the payout being removed/withdrawn so they remain available in the
-- party-scoped receipts library.

ALTER TABLE payout_documents
  ADD COLUMN party_id UUID;

-- Backfill from payouts.party_id (every existing row has a non-null payout_id).
UPDATE payout_documents pd
SET party_id = p.party_id
FROM payouts p
WHERE pd.payout_id = p.id;

-- Lock down party_id as NOT NULL and add FK + index.
ALTER TABLE payout_documents
  ALTER COLUMN party_id SET NOT NULL,
  ADD CONSTRAINT payout_documents_party_id_fkey
    FOREIGN KEY (party_id) REFERENCES parties(id) ON DELETE CASCADE;

CREATE INDEX idx_payout_documents_party_id ON payout_documents (party_id);

-- Loosen payout_id: make nullable AND change cascade -> SET NULL so withdrawn/
-- deleted payouts don't drop the receipt.
ALTER TABLE payout_documents
  DROP CONSTRAINT IF EXISTS payout_documents_payout_id_fkey,
  ALTER COLUMN payout_id DROP NOT NULL,
  ADD CONSTRAINT payout_documents_payout_id_fkey
    FOREIGN KEY (payout_id) REFERENCES payouts(id) ON DELETE SET NULL;
