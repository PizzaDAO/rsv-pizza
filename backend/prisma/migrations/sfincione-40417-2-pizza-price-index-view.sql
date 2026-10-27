-- sfincione-40417 (Phase 2): eligible-rows view for the Pizza Price Index.
--
-- Depends on sfincione-40417-1-pizza-price-index.sql (apply that first).
-- A plain VIEW (not materialized): the data is tiny (<5k rows) and a
-- matview would make verify -> index lag confusing during review.
--
-- Eligibility lives here in ONE place: non-duplicate, non-ineligible receipts,
-- lines that are not excluded, with a computed area and a positive price.
-- Bundles ARE included (is_bundle = true) so the API can toggle them in/out;
-- the verified / high-confidence / outlier policy is applied by the API.
--
-- Security: the view runs with the invoker's privileges (security_invoker) so
-- the RLS on the base tables applies, and anon/authenticated get no grants.
-- Do NOT expose this view via the Data API.

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
  ((li.unit_price_net * li.fx_rate) / li.area_cm2)::float8     AS net_usd_per_cm2
FROM pizza_line_items li
JOIN payout_documents d ON d.id = li.document_id
JOIN parties p          ON p.id = li.party_id
LEFT JOIN event_series es ON es.id = p.event_series_id
WHERE d.kind = 'receipt'
  AND d.is_duplicate = false
  AND d.ineligible = false
  AND li.excluded = false
  AND li.area_cm2 IS NOT NULL AND li.area_cm2 > 0
  AND li.unit_price_usd > 0;

REVOKE ALL ON pizza_price_index_lines FROM anon, authenticated;
