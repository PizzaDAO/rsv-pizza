-- Enable case + diacritic folding for GPP duplicate-city detection.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Flip the one stranded '' custom_url (Taipei) to NULL so the column is consistent
-- with the other 22 GPP events that already have NULL.
UPDATE parties
SET custom_url = NULL
WHERE event_type = 'gpp' AND custom_url = '';
