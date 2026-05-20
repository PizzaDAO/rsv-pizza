-- oregano-44102: prevent duplicate default checklist items per party.
--
-- Background: POST /:partyId/checklist/seed was a check-then-insert with no
-- DB-level guard. Two concurrent calls inserted defaults twice. Three parties
-- in prod currently have 32 default rows instead of 16.
--
-- This migration:
--   1. Dedups existing duplicates, preferring any completed row, then lowest id.
--   2. Adds a partial unique index on (party_id, name) WHERE is_default = true,
--      so future races fail-safe via ON CONFLICT in the seed handler.

BEGIN;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY party_id, name
      ORDER BY completed DESC, id ASC
    ) AS rn
  FROM checklist_items
  WHERE is_default = true
)
DELETE FROM checklist_items
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS checklist_items_party_default_name_unique
  ON checklist_items (party_id, name)
  WHERE is_default = true;

COMMIT;
