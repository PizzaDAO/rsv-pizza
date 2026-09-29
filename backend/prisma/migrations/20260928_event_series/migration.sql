-- White-label event series (Phase 1). Makes "series/campaign" a first-class
-- entity instead of hardcoded GPP logic. No behavior change: existing GPP parties
-- are backfilled to seeded gpp2026/gpp2027 rows; all fields are additive/nullable.
-- See plans/whitelabel-event-series.md.

-- 1) The series table.
CREATE TABLE "event_series" (
  "id"                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug"              TEXT         NOT NULL UNIQUE,
  "name"              TEXT         NOT NULL,
  "display_name"      TEXT         NOT NULL,
  "is_active"         BOOLEAN      NOT NULL DEFAULT true,
  "theme_class"       TEXT,
  "logo_url"          TEXT,
  "og_image_url"      TEXT,
  "description"       TEXT,
  "event_type"        TEXT,
  "public_tags"       TEXT[]       NOT NULL DEFAULT '{}',
  "internal_tags"     TEXT[]       NOT NULL DEFAULT '{}',
  "require_approval"  BOOLEAN      NOT NULL DEFAULT true,
  "hide_guests"       BOOLEAN      NOT NULL DEFAULT false,
  "photos_enabled"    BOOLEAN      NOT NULL DEFAULT true,
  "photos_public"     BOOLEAN      NOT NULL DEFAULT true,
  "event_date"        TIMESTAMPTZ,
  "event_start_time"  TEXT,
  "event_end_time"    TEXT,
  "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Series config is served through the backend (service-role Prisma client), not
-- read directly by the browser. Enable RLS with no policies (default-deny for
-- anon/authenticated) + revoke inherited grants. Matches the RLS discipline the
-- new-table CI guard enforces (scripts/check-rls-on-new-tables.js).
ALTER TABLE "event_series" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "event_series" FROM anon;
REVOKE ALL ON "event_series" FROM authenticated;

-- 2) Link parties to a series (nullable; standalone parties have none).
ALTER TABLE "parties" ADD COLUMN "event_series_id" UUID REFERENCES "event_series"("id") ON DELETE SET NULL;
CREATE INDEX "idx_parties_event_series_id" ON "parties"("event_series_id");

-- 3) Seed the two existing GPP series from the current GPP_DEFAULTS
--    (backend/src/routes/gpp.routes.ts). gpp2026 is the live public series;
--    gpp2027 is the pre-launch series (its parties carry the internal 'gpp2027'
--    tag today).
INSERT INTO "event_series"
  ("slug", "name", "display_name", "event_type", "public_tags", "internal_tags",
   "og_image_url", "description",
   "require_approval", "hide_guests", "photos_enabled", "photos_public")
VALUES
  ('gpp2026', 'Global Pizza Party 2026', 'Global Pizza Party', 'gpp',
   ARRAY['Global Pizza Party','wpc','ens'], ARRAY[]::TEXT[],
   'https://www.rsv.pizza/gpp-flyer-2026-og.jpg',
   E'Join us for the Global Pizza Party, a worldwide celebration of pizza and bitcoin, where communities around the world come together to share pizza and good vibes.\n\nWhat to expect:\n- Free pizza\n- Crypto enthusiasts\n- Good conversations\n\nRSVP to secure your slice!',
   true, false, true, true),
  ('gpp2027', 'Global Pizza Party 2027', 'Global Pizza Party', 'gpp',
   ARRAY['Global Pizza Party']::TEXT[], ARRAY['gpp2027']::TEXT[],
   'https://www.rsv.pizza/gpp-flyer-2026-og.jpg',
   NULL,
   true, false, true, true);

-- 4) Backfill existing GPP parties. Parties tagged 'gpp2027' -> the 2027 series;
--    all other event_type='gpp' parties -> the 2026 series.
UPDATE "parties"
   SET "event_series_id" = (SELECT "id" FROM "event_series" WHERE "slug" = 'gpp2027')
 WHERE "event_type" = 'gpp' AND 'gpp2027' = ANY("event_tags");

UPDATE "parties"
   SET "event_series_id" = (SELECT "id" FROM "event_series" WHERE "slug" = 'gpp2026')
 WHERE "event_type" = 'gpp' AND "event_series_id" IS NULL;
