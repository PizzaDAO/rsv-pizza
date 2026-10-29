SET lock_timeout = '5s';

-- sfincione-40417 (history): pre-2026 GPP receipts as a separate yearly index.
-- Backward compatible: old code never sees history rows (every machine pass
-- INNER JOINs payout_documents/parties), and the view keeps all existing
-- columns; new ones are appended. Idempotent.
-- Depends on sfincione-40417-1 and -2 (apply those first).

CREATE TABLE IF NOT EXISTS pizza_history_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file_id text NOT NULL UNIQUE,            -- Drive file id = dedupe key
  source_title text,
  source_url text,
  year int NOT NULL CHECK (year BETWEEN 2019 AND 2025),
  receipt_date date,
  country text NOT NULL,                          -- parties.country spelling
  city text,
  region text,                                    -- via countryNameToRegion
  merchant text,
  merchant_key text,
  currency char(3) NOT NULL,
  total numeric(14,4),
  kind text NOT NULL CHECK (kind IN ('itemized','lump_sum','not_pizza')),
  pizza_count numeric(8,2),
  fx_rate numeric(18,8),
  fx_source text,                                 -- e.g. 'frankfurter:2022-05-21', 'yahoo:...', 'manual'
  fx_date date,
  event_key text GENERATED ALWAYS AS ('hist:' || year::text || ':' || lower(trim(coalesce(city,''))) || '|' || country) STORED,
  raw jsonb NOT NULL,                             -- the transcribed record, for audit/re-import
  import_batch text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
ALTER TABLE pizza_history_receipts ENABLE ROW LEVEL SECURITY;   -- no policies (RLS audit)
REVOKE ALL ON pizza_history_receipts FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS pizza_history_receipts_year ON pizza_history_receipts(year);

ALTER TABLE pizza_line_items ALTER COLUMN document_id DROP NOT NULL;
ALTER TABLE pizza_line_items ALTER COLUMN party_id DROP NOT NULL;
ALTER TABLE pizza_line_items
  ADD COLUMN IF NOT EXISTS history_receipt_id uuid REFERENCES pizza_history_receipts(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pizza_line_items_origin_chk') THEN
    ALTER TABLE pizza_line_items ADD CONSTRAINT pizza_line_items_origin_chk CHECK (
      (document_id IS NOT NULL AND party_id IS NOT NULL AND history_receipt_id IS NULL) OR
      (document_id IS NULL AND party_id IS NULL AND history_receipt_id IS NOT NULL)) NOT VALID;
  END IF;
END $$;
ALTER TABLE pizza_line_items VALIDATE CONSTRAINT pizza_line_items_origin_chk;

CREATE UNIQUE INDEX IF NOT EXISTS pizza_line_items_hist_line
  ON pizza_line_items(history_receipt_id, line_index) WHERE history_receipt_id IS NOT NULL;

-- View: existing columns unchanged (same names/types/order), new ones appended.
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
  false                                   AS is_lump_sum
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
  AND li.unit_price_usd > 0;

REVOKE ALL ON pizza_price_index_lines FROM anon, authenticated;
