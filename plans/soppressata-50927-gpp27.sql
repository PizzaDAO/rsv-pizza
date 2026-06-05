-- soppressata-50927 — GPP27 admin-gated create flow
-- =====================================================================
-- APPLY MANUALLY BEFORE MERGE.
-- This repo has NO Prisma migrate auto-apply: SQL files under
-- backend/prisma/migrations/ are gitignored and never run, and loose .sql
-- files do NOT execute on deploy. Run this against the PRODUCTION database
-- (Supabase project znpiwdvvsqaxuskpfleo) via the Supabase SQL editor /
-- Supabase MCP / psql BEFORE merging this PR. The backend auto-deploys from
-- master ~1 minute after merge and will 500 on any query touching these
-- columns/tables until they exist.
-- =====================================================================

-- 1) New party columns: GPP27 City Host Agreement sign-off.
ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS agreement_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS agreement_version     text;

-- 2) New table: agreement clauses (data-driven checkbox items).
CREATE TABLE IF NOT EXISTS gpp_agreement_clauses (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  version      text        NOT NULL,
  sort_order   integer     NOT NULL,
  body         text        NOT NULL,
  requires_ack boolean     NOT NULL DEFAULT true,
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gpp_agreement_clauses_active_version_sort_idx
  ON gpp_agreement_clauses (active, version, sort_order);

-- 3) Seed the v1 clauses (verbatim from the plan; clause 2 uses the merged
--    timeline wording). `{tier amount}` is interpolated client-side from
--    getCityTier(city). Re-running is safe: it only seeds when v1 is absent.
INSERT INTO gpp_agreement_clauses (version, sort_order, body, requires_ack, active)
SELECT * FROM (VALUES
  ('v1', 1,
   'I understand that the reimbursement amount is limited to a maximum of {tier amount} USD per person, up to a total maximum reimbursement of $625 USD. (Example: If I submit valid proof showing 10 attendees at the party, I can receive up to 10 × {tier amount} USD reimbursement.)',
   true, true),
  ('v1', 2,
   'I understand that reimbursement typically takes ~7 days after I submit my receipt + photos; up to 2 weeks after May 22 to be fully processed.',
   true, true),
  ('v1', 3,
   'I understand that proof of the event is required for reimbursement. This includes: group photos showing the attendees; a photo of the pizza boxes / pizza stack; a 30-second video of the group shouting "Pizza for free!" or a similar phrase; and photos documenting the use of PizzaDAO merch (signs, table tents, flyers).',
   true, true),
  ('v1', 4,
   'I understand that reimbursement may be cancelled if fraud, fake attendance, manipulated media, or other dishonest behavior is discovered.',
   true, true),
  ('v1', 5,
   'I understand that my RSVP page can only go public after a valid merch delivery address has been provided.',
   true, true),
  ('v1', 6,
   'I understand that a receipt from the pizzeria is required for reimbursement.',
   true, true),
  ('v1', 7,
   'I understand that any additional expenses beyond pizza costs are not covered by PizzaDAO.',
   true, true)
) AS seed(version, sort_order, body, requires_ack, active)
WHERE NOT EXISTS (
  SELECT 1 FROM gpp_agreement_clauses WHERE version = 'v1'
);
