-- scam-flag-private step 1 (additive, safe to apply any time): anon can read
-- parties.event_tags, which mixes the public taxonomy ('side', 'swc', 'gpp2026',
-- partner/series tags) with admin-only control tags ('possible-scam', payout
-- state, numeric/k caps, launch gates). Expose a stripped copy instead.
--
-- public_event_tags is a GENERATED column (same precedent as co_hosts_public =
-- sanitize_co_hosts(co_hosts) and has_password): it can never drift from
-- event_tags and cannot be written directly. Not declared in schema.prisma.
--
-- The internal list below MUST match scripts/internal-event-tags.json (and so
-- INTERNAL_EVENT_TAGS / INTERNAL_TAG_PATTERNS in backend/src/lib/eventTags.ts).
-- backend/src/lib/eventTagsSql.test.ts parses this file and enforces parity.
-- To change the list later: CREATE OR REPLACE the function in a new migration,
-- then `UPDATE parties SET event_tags = event_tags` so the stored column is
-- recomputed for existing rows.
--
-- Semantics mirror publicTags()/isInternalTag(): trim, then drop a tag when its
-- lowercase form is in the tag list or it matches one of the patterns. Order is
-- preserved. NULL elements are dropped; NULL array -> '{}'.
CREATE OR REPLACE FUNCTION public.strip_internal_event_tags(tags text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
  SELECT COALESCE(array_agg(u.t ORDER BY u.i), '{}'::text[])
  FROM unnest(tags) WITH ORDINALITY AS u(t, i)
  WHERE u.t IS NOT NULL
    AND NOT (
      lower(regexp_replace(u.t, '^\s+|\s+$', '', 'g')) = ANY (ARRAY[
        -- internal-tags:begin
        'go', 'missed', 'nonhub', 'nonpres', 'paid', 'possible-scam', 'prepay', 'refund', 'side-prelaunch'
        -- internal-tags:end
      ]::text[])
      -- internal-patterns:begin
      OR regexp_replace(u.t, '^\s+|\s+$', '', 'g') ~ '^\d+(\.\d{1,2})?$'
      OR regexp_replace(u.t, '^\s+|\s+$', '', 'g') ~* '^k\d+(\.\d{1,2})?$'
      OR regexp_replace(u.t, '^\s+|\s+$', '', 'g') ~* '^gpp2027$'
      -- internal-patterns:end
    )
$fn$;

ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS public_event_tags text[]
  GENERATED ALWAYS AS (public.strip_internal_event_tags(event_tags)) STORED;

GRANT SELECT (public_event_tags) ON public.parties TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
