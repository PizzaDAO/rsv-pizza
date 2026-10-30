-- sfincione-40417 (pizza count): hash-stability check, READ-ONLY. For psql.
-- Run BEFORE and AFTER applying sfincione-40417-7-pizza-count.sql (query 1 works on both; query 2 needs the
-- migration applied). Both counts must be 0. The same check exists as scripts/check-pizza-count-hash.ts, which
-- imports the live HASH_SQL / COUNT_HASH_SQL from the service (prefer it: these copies can drift).

-- 1. HASH_SQL unchanged: no doc's stored items_hash differs from the current expression.
SELECT count(*) AS hash_drift
FROM pizza_line_sync s
JOIN payout_documents d ON d.id = s.document_id
LEFT JOIN payouts po ON po.id = d.payout_id
WHERE d.ocr_line_items IS NOT NULL
  AND s.items_hash <> md5(
    d.ocr_line_items::text || '|' || coalesce(d.original_currency,'') || '|' || coalesce(d.exchange_rate::text,'')
    || '|' || coalesce(d.ocr_currency,'') || '|' || coalesce(po.original_currency,'') || '|' || coalesce(po.exchange_rate::text,'')
    || '|' || coalesce(d.ocr_raw->'ocr'->>'merchant', d.ocr_raw->>'merchant','')
    || '|' || coalesce(jsonb_path_query_array(d.ocr_raw->'ocr'->'lineItems', '$[*] ? (@.subtotal < 0 || @.unitPrice < 0)')::text,''));

-- 2. After the migration: no doc is a count candidate (count_hash NULL == COUNT_HASH_SQL NULL for docs with no count/size).
SELECT count(*) AS count_drift
FROM pizza_line_sync s
JOIN payout_documents d ON d.id = s.document_id
WHERE s.count_hash IS DISTINCT FROM
  CASE WHEN d.pizza_count IS NULL AND d.pizza_size_cm IS NULL AND d.pizza_size_label IS NULL THEN NULL
       ELSE md5(coalesce(d.pizza_count::text,'') || '|' || coalesce(d.pizza_count_source,'') || '|' ||
                coalesce(d.pizza_size_cm::text,'') || '|' || coalesce(d.pizza_size_label,'') || '|' ||
                coalesce(d.pizza_size_source,'') || '|' || coalesce(d.original_amount::text,'') || '|' ||
                coalesce(d.ocr_amount::text,'')) END;
