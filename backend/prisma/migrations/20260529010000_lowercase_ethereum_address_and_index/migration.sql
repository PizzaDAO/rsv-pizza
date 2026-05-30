-- Lowercase + trim all existing ethereum_address values.
-- Guest wallet addresses (both 0x… and ENS) are case-insensitive at the
-- chain/DNS layer; storing mixed case caused 8 case-only duplicates in the
-- prod CSV export. See pancetta-58472.
UPDATE guests
SET ethereum_address = LOWER(TRIM(ethereum_address))
WHERE ethereum_address IS NOT NULL
  AND ethereum_address <> LOWER(TRIM(ethereum_address));

-- Functional index supports the per-event "is this wallet already on the
-- guest list?" soft-warn lookup and the cross-event DISTINCT export.
-- Non-unique on purpose — multi-attendee single-wallet households are
-- legitimate, so dedup is soft-warn at the app layer, not a constraint.
CREATE INDEX IF NOT EXISTS idx_guests_ethereum_address_lower
  ON guests (LOWER(ethereum_address))
  WHERE ethereum_address IS NOT NULL;
