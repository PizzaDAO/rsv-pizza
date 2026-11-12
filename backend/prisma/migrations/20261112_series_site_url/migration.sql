-- White-label: per-series site origin and brand name. Additive, nullable.
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "site_url" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "brand_name" TEXT;
