-- marinara-61455: image-authenticity (AI-generated / doctored) admin check.
--
-- A SEPARATE table (do NOT widen payout_documents or parties) that caches the
-- verdict of a manual, admin-triggered authenticity check on a payment-receipt
-- image or a host event-cover image. Advisory only — never auto-rejects.
--
-- ⚠️ This repo has NO Prisma migration auto-apply (`_prisma_migrations` doesn't
-- exist; SQL files under supabase/migrations/ do NOT run on backend deploy).
-- Apply this to PROD via Supabase MCP / pg+DATABASE_URL BEFORE merging the code,
-- and the backend deploys from `master` only (previews hit the prod backend).
--
-- FK notes (per repo memory: verify real table names before FK'ing):
--   * parties.id           -> uuid PK, table is "parties" (has @@map).
--   * payout_documents.id  -> uuid PK, table is "payout_documents" (has @@map).
-- Both are soft FKs with ON DELETE SET NULL so deleting a party/receipt never
-- cascades away the historical authenticity verdict (it stays as an audit row).

CREATE TABLE IF NOT EXISTS image_authenticity_checks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Supabase object URL that was checked. Lookup key for the cache.
  image_url           text NOT NULL,
  -- 'receipt' | 'event_image' — which surface the image came from.
  source_kind         text NOT NULL,
  -- Optional linkage for filtering / joins. Soft FKs (SET NULL on delete).
  party_id            uuid REFERENCES parties(id) ON DELETE SET NULL,
  payout_document_id  uuid REFERENCES payout_documents(id) ON DELETE SET NULL,
  -- Tiered verdict: 'authentic' | 'suspicious' | 'likely_fake'.
  verdict             text NOT NULL,
  -- Composite weighted score, 0-100 (higher = more likely fake/doctored).
  score               integer NOT NULL DEFAULT 0,
  -- Per-signal flags + the vision model's structured observations (jsonb).
  reasons             jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Which vision provider produced the primary verdict ('openai' | 'anthropic' | ...).
  provider            text NOT NULL DEFAULT 'openai',
  -- Phase 2 ELA overlay artifact (downloadable PNG in the event-images bucket).
  ela_artifact_url    text,
  checked_at          timestamptz NOT NULL DEFAULT now(),
  -- Admin email that triggered the check.
  checked_by          text
);

-- Cache lookup is by image_url ("return the cached row unless force").
CREATE INDEX IF NOT EXISTS idx_image_authenticity_checks_image_url
  ON image_authenticity_checks (image_url);

-- Filtering checks by party (e.g. all checks for a given event).
CREATE INDEX IF NOT EXISTS idx_image_authenticity_checks_party_id
  ON image_authenticity_checks (party_id);
