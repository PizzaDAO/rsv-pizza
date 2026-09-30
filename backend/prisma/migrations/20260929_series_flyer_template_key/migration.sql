-- White-label Phase 2c: per-series flyer template selection. Additive, nullable.
ALTER TABLE "event_series" ADD COLUMN "flyer_template_key" TEXT;
