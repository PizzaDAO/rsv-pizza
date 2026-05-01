-- RLS Lockdown: Drop dangerous permissive policies on parties and guests
--
-- The app routes all writes through the backend API which uses service_role
-- (bypasses RLS). These wide-open policies allowed any anonymous Supabase
-- client to UPDATE any party or DELETE any guest — a serious security hole.
--
-- Policies dropped:
--   parties: "Anyone can update parties"  (FOR UPDATE USING (true))
--   parties: "Anyone can create parties"  (FOR INSERT WITH CHECK (true))
--   guests:  "Anyone can delete guests"   (FOR DELETE USING (true))
--   guests:  "Anyone can add guests"      (FOR INSERT WITH CHECK (true))
--
-- Policies kept:
--   parties: "Anyone can read parties"    (FOR SELECT — needed by public event pages)
--   guests:  "Anyone can read guests"     (FOR SELECT — needed by host guest lists)
--
-- Frontend fallback paths that hit Supabase directly will stop working.
-- These only fire when the user is NOT authenticated (edge case), and all
-- normal flows go through the authenticated backend API.

-- ============================================================
-- parties table
-- ============================================================

-- Drop the permissive UPDATE policy (backend handles all party updates)
DROP POLICY IF EXISTS "Anyone can update parties" ON parties;

-- Drop the permissive INSERT policy (backend handles all party creation)
DROP POLICY IF EXISTS "Anyone can create parties" ON parties;

-- ============================================================
-- guests table
-- ============================================================

-- Drop the permissive DELETE policy (backend handles all guest removals)
DROP POLICY IF EXISTS "Anyone can delete guests" ON guests;

-- Drop the permissive INSERT policy (backend handles all guest creation,
-- including public RSVP submissions via /api/rsvp/:inviteCode/guest)
DROP POLICY IF EXISTS "Anyone can add guests" ON guests;
