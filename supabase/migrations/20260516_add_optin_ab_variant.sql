ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS optin_ab_variant TEXT;

-- Column-level SELECT grant (Feb 2026 security audit pattern)
GRANT SELECT (optin_ab_variant) ON guests TO anon, authenticated;
