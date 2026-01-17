-- Migration: Add all existing hosts (from co_hosts) to the guests table
-- This ensures hosts can bypass password protection via the guests table check

-- Insert hosts as guests where they don't already exist
INSERT INTO guests (
  party_id,
  name,
  email,
  dietary_restrictions,
  liked_toppings,
  disliked_toppings,
  liked_beverages,
  disliked_beverages,
  submitted_via
)
SELECT
  p.id as party_id,
  COALESCE(host->>'name', 'Host') as name,
  LOWER(host->>'email') as email,
  '{}' as dietary_restrictions,
  '{}' as liked_toppings,
  '{}' as disliked_toppings,
  '{}' as liked_beverages,
  '{}' as disliked_beverages,
  'host' as submitted_via
FROM
  parties p,
  jsonb_array_elements(p.co_hosts) as host
WHERE
  host->>'email' IS NOT NULL
  AND host->>'email' != ''
  AND NOT EXISTS (
    SELECT 1 FROM guests g
    WHERE g.party_id = p.id
    AND LOWER(g.email) = LOWER(host->>'email')
  );

-- Show how many hosts were added
-- SELECT COUNT(*) as hosts_added FROM guests WHERE submitted_via = 'host';
