SET lock_timeout = '5s';

-- sfincione-40417: extra presets found while parsing real receipts.
-- Idempotent. Apply after sfincione-40417-1 (seed rows there are unchanged).

-- "Monster" (India menus: "Monster [22] Serves 5"). Only a low-confidence
-- fallback when no inch/cm number is printed.
INSERT INTO pizza_size_presets (scope, size_label, shape, diameter_cm, source, notes, created_by) VALUES
  ('global','monster','round',45,'manual','seed: "monster" size word, fallback when no number is printed','seed')
ON CONFLICT DO NOTHING;

-- Brazil "1/1" (whole pie) with no other cue: typical pizza grande, 8 fatias.
-- Unverified estimate; reviewers/merchant presets override it.
INSERT INTO pizza_size_presets (scope, country, size_label, shape, diameter_cm, source, notes, created_by) VALUES
  ('country','Brazil','default','round',35,'manual','seed: typical pizza grande (8 fatias); unverified estimate for "1/1" lines','seed')
ON CONFLICT DO NOTHING;
