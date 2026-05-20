-- ============================================
-- Allow 'payment_admin' in admins.role CHECK (arugula-38633 v2 follow-up)
-- ============================================
-- PR #360 added the 'payment_admin' role concept in code (backend isPaymentAdmin
-- helper, frontend Add-Admin role picker, accepted in POST /api/admin/add) but
-- missed the DB-level CHECK constraint on admins.role. Inserting a row with
-- role='payment_admin' failed with CHECK violation → /admin add-payment-admin
-- returned 500. Hit by Snax on 2026-05-20.
--
-- This migration drops the old 2-value CHECK and adds a 3-value version that
-- includes 'payment_admin'. Already applied to prod via Supabase Management
-- API at the time of the bug report; this file is the on-disk record so any
-- fresh-DB replay (staging, local) ends up in the same state.
-- ============================================

ALTER TABLE admins DROP CONSTRAINT IF EXISTS admins_role_check;

ALTER TABLE admins ADD CONSTRAINT admins_role_check
  CHECK (role = ANY (ARRAY['super_admin'::text, 'admin'::text, 'payment_admin'::text]));
