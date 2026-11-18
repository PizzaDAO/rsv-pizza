-- scam-flag-private step 3 (DESTRUCTIVE for old clients): stop anon/authenticated
-- reading the raw parties.event_tags (admin-only tags such as 'possible-scam').
--
-- DO NOT APPLY until BOTH:
--   1. 20261118_parties_public_event_tags is applied (public_event_tags exists and is granted), and
--   2. the frontend that selects `event_tags:public_event_tags` instead of `event_tags` has been
--      live on prod for ~24h (cached SPA bundles that still select event_tags would otherwise get
--      42501 on EVERY party read).
-- Apply with: node backend/scripts/apply-public-event-tags.cjs --revoke --apply
-- Undo with:  node backend/scripts/apply-public-event-tags.cjs --rollback-revoke
--
-- The lockdown granted parties at column level, so a column-level REVOKE is exact.
REVOKE SELECT (event_tags) ON public.parties FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
