ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS swc_br_opt_in BOOLEAN NOT NULL DEFAULT false;

-- Column-level SELECT grant (Feb 2026 security audit pattern)
GRANT SELECT (swc_br_opt_in) ON guests TO anon, authenticated;
