-- Update sanitize_co_hosts to only strip email (not canEdit/isUnderboss)
--
-- canEdit and isUnderboss are non-sensitive permission flags that the frontend
-- needs for edit-access checks. Stripping them forced a fragile backend
-- roundtrip just to restore permissions. Only email is PII.

-- 1. Drop the generated column (depends on the old function signature)
ALTER TABLE parties DROP COLUMN co_hosts_public;

-- 2. Replace the function — only strip email
CREATE OR REPLACE FUNCTION sanitize_co_hosts(hosts jsonb)
RETURNS jsonb AS $$
  SELECT COALESCE(
    jsonb_agg(elem - 'email'),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(COALESCE(hosts, '[]'::jsonb)) AS elem;
$$ LANGUAGE sql IMMUTABLE;

-- 3. Recreate the generated column with the updated function
ALTER TABLE parties ADD COLUMN co_hosts_public jsonb
  GENERATED ALWAYS AS (sanitize_co_hosts(co_hosts)) STORED;

-- 4. Re-grant SELECT on the new column (column-level grants don't survive drop)
GRANT SELECT (co_hosts_public) ON parties TO anon, authenticated;
