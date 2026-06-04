-- tonno-58471: site-suggestion submissions table
-- NOTE: this repo does NOT auto-apply migrations; this file is documentation
-- parity only. The `suggestions` table was applied to prod directly.

CREATE TABLE IF NOT EXISTS "suggestions" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "body"       text NOT NULL,
  "image_url"  text,
  "name"       text,
  "email"      text,
  "page_url"   text,
  "status"     text NOT NULL DEFAULT 'new',
  "ai_summary" text,
  "ai_tags"    text[]
);

-- Row Level Security: allow anonymous inserts (public suggestion form),
-- but no public reads. Service role / admins read via the dashboard.
ALTER TABLE "suggestions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suggestions_anon_insert"
  ON "suggestions"
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
