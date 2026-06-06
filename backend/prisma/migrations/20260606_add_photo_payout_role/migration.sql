-- porchetta-58296: host-designated payout role photos.
-- One live photo per role per event; gates payout submission.
ALTER TABLE photos ADD COLUMN payout_role text;
ALTER TABLE photos ADD COLUMN payout_role_set_at timestamptz;
ALTER TABLE photos ADD COLUMN payout_role_set_by text;
CREATE UNIQUE INDEX photos_party_payout_role_uniq
  ON photos (party_id, payout_role)
  WHERE payout_role IS NOT NULL AND deleted_at IS NULL;
