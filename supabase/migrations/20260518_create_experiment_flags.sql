-- Generic experiment / feature flag registry.
-- Each row is a single named on/off switch. Public clients can SELECT
-- (key, enabled) so the RSVP form can gate experiments without a backend
-- round-trip. Writes go through the backend (service_role) only.

CREATE TABLE IF NOT EXISTS experiment_flags (
  key         TEXT PRIMARY KEY,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT
);

-- Seed parmesan-98989 with the experiment OFF. Snax flips it on from /admin
-- once SWC legal sign-off is in hand.
INSERT INTO experiment_flags (key, enabled, description)
VALUES (
  'optin_ab_pizzadao_partners',
  false,
  'parmesan-98989: combined PizzaDAO+SWC opt-in checkbox A/B test (US swc events). When OFF, all swc RSVPs render the two-checkbox baseline and no optin_ab_variant is written.'
) ON CONFLICT (key) DO NOTHING;

-- Column-level public read of just (key, enabled). description / updated_at /
-- updated_by stay admin-only via the backend endpoint.
GRANT SELECT (key, enabled) ON experiment_flags TO anon, authenticated;

-- All writes go through the backend (service_role bypasses RLS / grants).
-- Do not GRANT UPDATE / INSERT / DELETE to anon or authenticated.

-- RLS: enable and add a permissive SELECT policy for the two readable columns.
-- The column-level GRANT above is the actual hardening; RLS is added per the
-- February 2026 security-audit pattern so the table isn't an exception to the
-- lockdown convention.
ALTER TABLE experiment_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read experiment flags"
  ON experiment_flags FOR SELECT
  USING (true);
