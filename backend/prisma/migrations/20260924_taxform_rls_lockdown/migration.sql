-- salame-92110 SECURITY FIX: tax_forms was readable by unauthenticated users.
--
-- The original 20260531_tax_forms migration protected form_data with
-- column-level GRANTs to the `authenticated` role but never enabled Row Level
-- Security. In Supabase, tables in the public schema carry default privileges
-- for the `anon` role, and RLS is the intended access gate. With RLS off, the
-- anon PostgREST role could SELECT every column of tax_forms -- including
-- form_data (legal name, address, SSN/EIN) and pdf_url -- and follow pdf_url
-- to the (public) stored PDF. Confirmed live: anon SELECT returned HTTP 206
-- over real rows on 2026-09-24.
--
-- All application access to tax_forms goes through the backend service-role
-- Prisma client over DATABASE_URL (the table-owner role), which BYPASSES RLS.
-- The frontend never queries tax_forms directly (it uses /api/tax-forms/*).
-- Therefore enabling RLS with no policies fully closes PostgREST access for
-- both anon AND authenticated without affecting the app.

-- 1) Enable RLS. No policies == default-deny for every PostgREST role. The
--    table owner (Prisma over DATABASE_URL) and the service_role key are
--    unaffected, so the backend keeps working.
ALTER TABLE "tax_forms" ENABLE ROW LEVEL SECURITY;

-- 2) Defense in depth: revoke the table privileges the anon/authenticated
--    roles inherited from Supabase default privileges. The frontend reads tax
--    forms only via the backend API, so neither PostgREST role needs any
--    direct grant on this table.
REVOKE ALL ON "tax_forms" FROM anon;
REVOKE ALL ON "tax_forms" FROM authenticated;

-- Left intact on purpose:
--   * parties.tax_form_required  -- non-sensitive boolean read by the public
--     party fetch (frontend/src/lib/supabase.ts), still granted to anon.
--   * payouts.tax_form_id        -- FK only, no PII.
