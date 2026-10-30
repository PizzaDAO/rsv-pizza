SET lock_timeout = '5s';

-- sfincione-40417 (pizza count): optional pizza count + size per receipt (auto-filled from
-- OCR/LLM, host-correctable) so lump-sum receipts still yield an estimated per-pizza price.
-- Backward compatible: every new column is nullable with no default (metadata-only), old code
-- never selects them, and the view keeps the same column names/types/order.
-- Depends on sfincione-40417-1, -2, -6. Idempotent. Apply to prod BEFORE merging the Prisma change.

ALTER TABLE payout_documents ADD COLUMN IF NOT EXISTS pizza_count integer;
ALTER TABLE payout_documents ADD COLUMN IF NOT EXISTS pizza_count_source text;
ALTER TABLE payout_documents ADD COLUMN IF NOT EXISTS pizza_count_confidence numeric(3,2);
ALTER TABLE payout_documents ADD COLUMN IF NOT EXISTS pizza_size_cm numeric(5,1);
ALTER TABLE payout_documents ADD COLUMN IF NOT EXISTS pizza_size_label text;
ALTER TABLE payout_documents ADD COLUMN IF NOT EXISTS pizza_size_source text;
ALTER TABLE payout_documents ADD COLUMN IF NOT EXISTS pizza_size_confidence numeric(3,2);
ALTER TABLE pizza_line_sync  ADD COLUMN IF NOT EXISTS count_hash text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payout_documents_pizza_count_chk') THEN
    ALTER TABLE payout_documents ADD CONSTRAINT payout_documents_pizza_count_chk CHECK (
      (pizza_count IS NULL OR pizza_count BETWEEN 1 AND 5000)
      AND (pizza_count_source IS NULL OR pizza_count_source IN ('ocr','llm','host'))
      AND (pizza_count_confidence IS NULL OR pizza_count_confidence BETWEEN 0 AND 1)
      AND (pizza_count IS NULL OR pizza_count_source IS NOT NULL)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payout_documents_pizza_size_chk') THEN
    ALTER TABLE payout_documents ADD CONSTRAINT payout_documents_pizza_size_chk CHECK (
      (pizza_size_cm IS NULL OR pizza_size_cm BETWEEN 15 AND 80)
      AND (pizza_size_label IS NULL OR length(pizza_size_label) <= 40)
      AND (pizza_size_source IS NULL OR pizza_size_source IN ('ocr','llm','host'))
      AND (pizza_size_confidence IS NULL OR pizza_size_confidence BETWEEN 0 AND 1)
      AND ((pizza_size_cm IS NULL AND pizza_size_label IS NULL) OR pizza_size_source IS NOT NULL)) NOT VALID;
  END IF;
END $$;
ALTER TABLE payout_documents VALIDATE CONSTRAINT payout_documents_pizza_count_chk;
ALTER TABLE payout_documents VALIDATE CONSTRAINT payout_documents_pizza_size_chk;

-- View: sfincione-40417-6's definition verbatim, with ONE change in the event branch:
--   false AS is_lump_sum   ->   (li.source_category = 'lump_sum') AS is_lump_sum
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
  AND li.unit_price_usd > 0;

REVOKE ALL ON pizza_price_index_lines FROM anon, authenticated;
