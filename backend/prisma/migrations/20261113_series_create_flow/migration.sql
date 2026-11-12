-- White-label streamlined create flow: per-series preset key + name template. Additive, nullable.
-- create_flow NULL = generic create flow (current behavior). Values are also validated in code
-- (global_day | meetup | hackathon); the CHECK is a backstop.
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "create_flow" TEXT;
ALTER TABLE "event_series" ADD COLUMN IF NOT EXISTS "name_template" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_series_create_flow_check') THEN
    ALTER TABLE "event_series" ADD CONSTRAINT "event_series_create_flow_check"
      CHECK ("create_flow" IS NULL OR "create_flow" IN ('global_day', 'meetup', 'hackathon'));
  END IF;
END $$;
