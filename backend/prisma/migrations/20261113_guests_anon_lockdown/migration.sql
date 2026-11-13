-- SECURITY (guests-anon-exposure, Migration B): guests + user_preferences were readable by the
-- public key (USING (true) + default table grants). Verified 2026-11-12: 44,512 guest emails,
-- 6,984 wallets, 4,449 survey tokens, 158 privy ids, 44,567 guest ids (bearer capability for
-- mint/raffle/quiz/discount); 28,721 user_preferences emails, and anon INSERT/UPDATE on
-- user_preferences. No anon code path needs either table any more (PR1a #1220 + PR1b #1218).
-- Two layers: no grants AND no anon policy.
--
-- Applied by backend/scripts/apply-lockdown-guests.cjs (dry run / --simulate / --apply), which
-- executes THIS file statement by statement in one transaction and skips the ALTER PUBLICATION
-- when guests is no longer a member.
-- ROLLBACK: backend/scripts/apply-lockdown-guests.cjs --rollback
--
-- Not here: experiment_flags.updated_by (D9) is locked by apply-lockdown-parties-columns.cjs.
REVOKE ALL ON public.guests FROM anon, authenticated;
REVOKE ALL ON public.user_preferences FROM anon, authenticated;
DROP POLICY IF EXISTS "Public can read guests" ON public.guests;
DROP POLICY IF EXISTS "Allow public read" ON public.user_preferences;
DROP POLICY IF EXISTS "Allow public insert" ON public.user_preferences;
DROP POLICY IF EXISTS "Allow public update" ON public.user_preferences;
-- Dead policies (auth.uid() is never a guest id) whose subquery on guests would now raise 42501
-- for anon on any superlative_submissions read. The service-role policy stays.
DROP POLICY IF EXISTS "Guests can read own superlative submissions" ON public.superlative_submissions;
DROP POLICY IF EXISTS "Guests can insert own superlative submissions" ON public.superlative_submissions;
DROP POLICY IF EXISTS "Guests can update own superlative submissions" ON public.superlative_submissions;
-- Host live updates use broadcast (Migration A, 20261112_guests_broadcast_trigger). Nothing may
-- subscribe to guests rows via postgres_changes.
ALTER PUBLICATION supabase_realtime DROP TABLE public.guests;
NOTIFY pgrst, 'reload schema';
