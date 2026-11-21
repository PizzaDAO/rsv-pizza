-- capers-11903: stop anon/authenticated reading parties.reimbursement_cap_usd (underboss-validated
-- reimbursement caps are host/admin-only; hosts get them via GET /api/parties/:id).
--
-- DO NOT APPLY until the frontend that no longer selects reimbursement_cap_usd (SAFE_PARTY_COLUMNS)
-- has been live on prod for ~24h (cached SPA bundles that still select it would otherwise get
-- 42501 on EVERY party read), same sequencing as 20261119_revoke_anon_event_tags.
-- The lockdown granted parties at column level, so a column-level REVOKE is exact.
-- Undo: GRANT SELECT (reimbursement_cap_usd) ON public.parties TO anon, authenticated;
REVOKE SELECT (reimbursement_cap_usd) ON public.parties FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
