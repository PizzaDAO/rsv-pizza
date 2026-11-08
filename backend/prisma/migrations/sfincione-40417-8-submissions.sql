BEGIN;
SET LOCAL lock_timeout = '5s';

-- sfincione-40417 (submissions): public receipt submissions, reviewed by an admin, then counted
-- in the Pizza Price Index as a third origin ('submission').
-- Backward compatible: no 'approved' submission rows exist until the new code approves one, so
-- old code sees no new view rows; the view keeps the same column names/types/order.
-- Depends on sfincione-40417-1, -2, -6, -7 (apply those first). Idempotent.
-- Apply to prod BEFORE merging the Prisma change. NOT applied by the PR.
-- The private storage bucket `pizza-index-submissions` is created in the Supabase dashboard
-- (10 MB cap; image/jpeg, image/png, image/webp, image/heic, application/pdf).

CREATE TABLE IF NOT EXISTS pizza_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitter_user_id text REFERENCES "User"(id) ON DELETE SET NULL,   -- null = anonymous
  submitter_email text,                                              -- optional, admin-only
  notify boolean NOT NULL DEFAULT false,
  storage_path text NOT NULL UNIQUE,                                 -- object path in the private bucket, never a URL
  ocr_image_path text,                                               -- PNG rendered from page 1 of a PDF
  mime_type text NOT NULL,
  file_size int NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  file_sha256 text NOT NULL,
  receipt_date date NOT NULL,
  year int NOT NULL CHECK (year BETWEEN 2021 AND 2100),
  country text NOT NULL,
  country_code char(2),
  city text,
  region text,
  merchant text NOT NULL,
  merchant_key text,
  size_note text CHECK (size_note IS NULL OR length(size_note) <= 200),
  kind text CHECK (kind IS NULL OR kind IN ('itemized','lump_sum','not_pizza')),   -- set on approve
  currency char(3),
  total numeric(14,4),
  pizza_count numeric(8,2),
  fx_rate numeric(18,8),
  fx_source text,
  fx_date date,
  ocr_raw jsonb,
  ocr_at timestamptz,
  duplicate_of uuid REFERENCES pizza_submissions(id) ON DELETE SET NULL,
  duplicate_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  reject_reason text,
  ip_hash text,                                                      -- sha256(ip + secret), abuse review only
  event_key text GENERATED ALWAYS AS (
    'sub:' || year::text || ':' || coalesce(merchant_key, id::text) || '|' || lower(trim(coalesce(city,''))) || '|' || country
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
ALTER TABLE pizza_submissions ENABLE ROW LEVEL SECURITY;            -- no policies (RLS audit)
REVOKE ALL ON pizza_submissions FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS pizza_submissions_status_created ON pizza_submissions(status, created_at);
CREATE INDEX IF NOT EXISTS pizza_submissions_user_created ON pizza_submissions(submitter_user_id, created_at);
CREATE INDEX IF NOT EXISTS pizza_submissions_ip_created ON pizza_submissions(ip_hash, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS pizza_submissions_sha ON pizza_submissions(file_sha256);
CREATE INDEX IF NOT EXISTS pizza_submissions_merchant_date ON pizza_submissions(merchant_key, receipt_date);

ALTER TABLE pizza_line_items
  ADD COLUMN IF NOT EXISTS submission_id uuid REFERENCES pizza_submissions(id) ON DELETE CASCADE;

ALTER TABLE pizza_line_items DROP CONSTRAINT IF EXISTS pizza_line_items_origin_chk;
ALTER TABLE pizza_line_items ADD CONSTRAINT pizza_line_items_origin_chk CHECK (
  (document_id IS NOT NULL AND party_id IS NOT NULL AND history_receipt_id IS NULL AND submission_id IS NULL) OR
  (document_id IS NULL AND party_id IS NULL AND history_receipt_id IS NOT NULL AND submission_id IS NULL) OR
  (document_id IS NULL AND party_id IS NULL AND history_receipt_id IS NULL AND submission_id IS NOT NULL)) NOT VALID;
ALTER TABLE pizza_line_items VALIDATE CONSTRAINT pizza_line_items_origin_chk;

CREATE UNIQUE INDEX IF NOT EXISTS pizza_line_items_sub_line
  ON pizza_line_items(submission_id, line_index) WHERE submission_id IS NOT NULL;

-- View: sfincione-40417-7's definition verbatim, plus a third UNION ALL branch for approved
-- submissions. document_url / document_mime_type are NULL for submissions: the storage path
-- never goes into the view.
CREATE OR REPLACE VIEW pizza_price_index_lines
WITH (security_invoker = true) AS
SELECT
  li.id                                   AS line_id,
  li.document_id,
  li.party_id,
  p.name                                  AS party_name,
  p.country,
  p.city,
  p.region,
  p.event_series_id,
  es.slug                                 AS event_series_slug,
  COALESCE(EXTRACT(YEAR FROM p.date)::int,
           EXTRACT(YEAR FROM d.created_at)::int) AS event_year,
  d.url                                   AS document_url,
  d.mime_type                             AS document_mime_type,
  d.source_receipt_index,
  d.source_receipt_count,
  li.merchant,
  li.merchant_key,
  li.raw_name,
  li.qty::float8                          AS qty,
  li.currency::text                       AS currency,
  li.fx_rate::float8                      AS fx_rate,
  li.unit_price_list::float8              AS unit_price_list,
  li.unit_price_net::float8               AS unit_price_net,
  li.unit_price_usd::float8               AS unit_price_usd,
  (li.unit_price_net * li.fx_rate)::float8 AS unit_price_net_usd,
  li.size_label,
  li.shape,
  li.diameter_cm::float8                  AS diameter_cm,
  li.area_cm2::float8                     AS area_cm2,
  li.style,
  li.size_source,
  li.size_confidence::float8              AS size_confidence,
  li.verified_at,
  li.verified_by,
  (li.verified_at IS NOT NULL)            AS is_verified,
  li.outlier_flag,
  li.is_bundle,
  (li.unit_price_usd / li.area_cm2)::float8                    AS usd_per_cm2,
  (li.unit_price_list / li.area_cm2)::float8                   AS local_per_cm2,
  ((li.unit_price_net * li.fx_rate) / li.area_cm2)::float8     AS net_usd_per_cm2,
  li.party_id::text                       AS event_key,
  'event'::text                           AS origin,
  NULL::text                              AS fx_source,
  p.date::date                            AS receipt_date,
  (li.source_category = 'lump_sum')       AS is_lump_sum
FROM pizza_line_items li
JOIN payout_documents d ON d.id = li.document_id
JOIN parties p          ON p.id = li.party_id
LEFT JOIN event_series es ON es.id = p.event_series_id
WHERE d.kind = 'receipt'
  AND d.is_duplicate = false
  AND d.ineligible = false
  AND li.excluded = false
  AND li.area_cm2 IS NOT NULL AND li.area_cm2 > 0
  AND li.unit_price_usd > 0
UNION ALL
SELECT
  li.id,
  NULL::uuid,
  NULL::uuid,
  h.year::text || ' ' || coalesce(h.city, h.country),
  h.country,
  h.city,
  h.region,
  NULL::uuid,
  NULL::text,
  h.year,
  h.source_url,
  NULL::text,
  NULL::int,
  NULL::int,
  li.merchant,
  li.merchant_key,
  li.raw_name,
  li.qty::float8,
  li.currency::text,
  li.fx_rate::float8,
  li.unit_price_list::float8,
  li.unit_price_net::float8,
  li.unit_price_usd::float8,
  (li.unit_price_net * li.fx_rate)::float8,
  li.size_label,
  li.shape,
  li.diameter_cm::float8,
  li.area_cm2::float8,
  li.style,
  li.size_source,
  li.size_confidence::float8,
  li.verified_at,
  li.verified_by,
  (li.verified_at IS NOT NULL),
  li.outlier_flag,
  li.is_bundle,
  (li.unit_price_usd / li.area_cm2)::float8,
  (li.unit_price_list / li.area_cm2)::float8,
  ((li.unit_price_net * li.fx_rate) / li.area_cm2)::float8,
  h.event_key,
  'history'::text,
  h.fx_source,
  h.receipt_date,
  (h.kind = 'lump_sum')
FROM pizza_line_items li
JOIN pizza_history_receipts h ON h.id = li.history_receipt_id
WHERE h.kind <> 'not_pizza'
  AND li.excluded = false
  AND li.area_cm2 IS NOT NULL AND li.area_cm2 > 0
  AND li.unit_price_usd > 0
UNION ALL
SELECT
  li.id,
  NULL::uuid,
  NULL::uuid,
  s.merchant,
  s.country,
  s.city,
  s.region,
  NULL::uuid,
  NULL::text,
  s.year,
  NULL::text,                       -- document_url: never the storage path
  NULL::text,                       -- document_mime_type
  NULL::int,
  NULL::int,
  li.merchant,
  li.merchant_key,
  li.raw_name,
  li.qty::float8,
  li.currency::text,
  li.fx_rate::float8,
  li.unit_price_list::float8,
  li.unit_price_net::float8,
  li.unit_price_usd::float8,
  (li.unit_price_net * li.fx_rate)::float8,
  li.size_label,
  li.shape,
  li.diameter_cm::float8,
  li.area_cm2::float8,
  li.style,
  li.size_source,
  li.size_confidence::float8,
  li.verified_at,
  li.verified_by,
  (li.verified_at IS NOT NULL),
  li.outlier_flag,
  li.is_bundle,
  (li.unit_price_usd / li.area_cm2)::float8,
  (li.unit_price_list / li.area_cm2)::float8,
  ((li.unit_price_net * li.fx_rate) / li.area_cm2)::float8,
  s.event_key,
  'submission'::text,
  s.fx_source,
  s.receipt_date,
  (s.kind = 'lump_sum')
FROM pizza_line_items li
JOIN pizza_submissions s ON s.id = li.submission_id
WHERE s.status = 'approved'
  AND s.kind IS NOT NULL AND s.kind <> 'not_pizza'
  AND li.excluded = false
  AND li.area_cm2 IS NOT NULL AND li.area_cm2 > 0
  AND li.unit_price_usd > 0;

REVOKE ALL ON pizza_price_index_lines FROM anon, authenticated;

COMMIT;
