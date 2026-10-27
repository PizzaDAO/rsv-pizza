-- sfincione-40417 (Phase 1): Pizza Price Index tables.
--
-- Normalized side tables that hold one row per pizza line on a GPP receipt,
-- plus size presets and a per-document sync marker. NOTHING here writes to
-- payout_documents. RLS is enabled with NO policies (backend connects as the
-- table owner; anon gets nothing, per the 2026-10 RLS audit).
--
-- Idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING). Apply to prod BEFORE
-- merging the PR that adds the Prisma models (CLAUDE.md "Migration safety").
-- Apply order: this file, then sfincione-40417-2-pizza-price-index-view.sql.

-- Sizes known for a pizzeria / chain / country / global size word.
-- For shape='slice' rows: diameter_cm is the PARENT pie diameter and
-- slice_fraction the fraction of it (e.g. 0.125 of a 45 cm pie).
CREATE TABLE IF NOT EXISTS pizza_size_presets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         text NOT NULL CHECK (scope IN ('merchant','chain','country','global')),
  merchant_key  text,                       -- normalized merchant/chain name
  country       text,                       -- parties.country spelling (full English name)
  size_label    text NOT NULL,              -- 'personal','small','medium','large','xl','family','mega','slice','default', or a literal like '33cm'
  shape         text NOT NULL CHECK (shape IN ('round','rect','slice')),
  diameter_cm   numeric(5,1),
  length_cm     numeric(5,1),
  width_cm      numeric(5,1),
  slice_fraction numeric(4,3),
  source        text NOT NULL CHECK (source IN ('manual','web','llm')),
  source_url    text,
  notes         text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS pizza_size_presets_key
  ON pizza_size_presets (scope, coalesce(merchant_key,''), coalesce(country,''), size_label);

-- One row per pizza line on a receipt document.
CREATE TABLE IF NOT EXISTS pizza_line_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid NOT NULL REFERENCES payout_documents(id) ON DELETE CASCADE,
  party_id         uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  line_index       int  NOT NULL,                 -- index into payout_documents.ocr_line_items
  line_fingerprint text NOT NULL,                 -- md5(lower(name)|qty|unitPrice) of the OCR line; change => re-review
  source_category  text NOT NULL DEFAULT 'pizza', -- OCR category of the source line ('pizza', or 'other'/... when the LLM pass promoted it)
  raw_name         text NOT NULL,
  merchant         text,
  merchant_key     text,
  qty              numeric(8,2) NOT NULL,
  unit_price_list  numeric(14,4) NOT NULL,        -- original currency, as printed (menu/list price)
  unit_price_net   numeric(14,4),                 -- after pro-rata receipt discounts (original currency)
  discount_amount  numeric(14,4),                 -- discount allocated to this line, per unit (original currency)
  discount_label   text,
  currency         char(3) NOT NULL,
  fx_rate          numeric(18,8) NOT NULL,        -- USD per 1 unit of currency
  unit_price_usd   numeric(12,4) NOT NULL,        -- list price in USD
  size_label       text,
  shape            text CHECK (shape IN ('round','rect','slice','other')),
  diameter_cm      numeric(5,1),
  length_cm        numeric(5,1),
  width_cm         numeric(5,1),
  slice_fraction   numeric(4,3),
  area_cm2         numeric(8,1),                  -- computed in backend on write
  style            text,                          -- 'neapolitan','ny','pan','detroit','sicilian','thin','other'
  size_source      text CHECK (size_source IN ('parsed','preset','llm','web','manual')),
  size_confidence  numeric(3,2),
  preset_id        uuid REFERENCES pizza_size_presets(id) ON DELETE SET NULL,
  verified_by      text,
  verified_at      timestamptz,
  updated_by       text,
  excluded         boolean NOT NULL DEFAULT false,
  excluded_reason  text,                          -- 'lump_sum','not_pizza','zero_price','duplicate_line','unreadable','other'
  is_bundle        boolean NOT NULL DEFAULT false,-- all-you-can-eat / party packs; listed separately, not in core medians
  outlier_flag     boolean NOT NULL DEFAULT false,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz,
  UNIQUE (document_id, line_index)
);
CREATE INDEX IF NOT EXISTS pizza_line_items_party ON pizza_line_items(party_id);
CREATE INDEX IF NOT EXISTS pizza_line_items_queue ON pizza_line_items(verified_at, excluded, size_confidence);
CREATE INDEX IF NOT EXISTS pizza_line_items_merchant ON pizza_line_items(merchant_key);

-- Per-document sync marker so the sweep knows what changed.
CREATE TABLE IF NOT EXISTS pizza_line_sync (
  document_id    uuid PRIMARY KEY REFERENCES payout_documents(id) ON DELETE CASCADE,
  items_hash     text NOT NULL,
  synced_at      timestamptz NOT NULL DEFAULT now(),
  llm_pass_at    timestamptz,                     -- gpt-4o-mini text pass done for this items_hash
  vision_pass_at timestamptz,                     -- gpt-4o vision pass done for this items_hash
  discounts      jsonb,                           -- [{label, amount}] receipt-level discount lines (original currency)
  discount_total numeric(14,4)
);

ALTER TABLE pizza_size_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_line_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_line_sync    ENABLE ROW LEVEL SECURITY;

-- Belt and braces: no Data API grants for anon/authenticated.
REVOKE ALL ON pizza_size_presets FROM anon, authenticated;
REVOKE ALL ON pizza_line_items   FROM anon, authenticated;
REVOKE ALL ON pizza_line_sync    FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed presets (plan sections 5 and 12). All source='manual'.
-- ---------------------------------------------------------------------------
INSERT INTO pizza_size_presets (scope, size_label, shape, diameter_cm, source, notes, created_by) VALUES
  ('global','personal','round',20,'manual','seed: global size word','seed'),
  ('global','small',   'round',25,'manual','seed: global size word','seed'),
  ('global','medium',  'round',30,'manual','seed: global size word','seed'),
  ('global','regular', 'round',30,'manual','seed: global size word','seed'),
  ('global','large',   'round',35,'manual','seed: global size word','seed'),
  ('global','xl',      'round',40,'manual','seed: global size word','seed'),
  ('global','family',  'round',40,'manual','seed: global size word','seed'),
  ('global','mega',    'round',40,'manual','seed: global size word','seed')
ON CONFLICT DO NOTHING;

INSERT INTO pizza_size_presets (scope, size_label, shape, diameter_cm, slice_fraction, source, notes, created_by) VALUES
  ('global','slice','slice',45,0.125,'manual','seed: one slice = 1/8 of a 45 cm pie','seed')
ON CONFLICT DO NOTHING;

-- India chains: regular 18-20 / medium 25 / large 33 cm (La Pino'z prints "Large Serves 4, 33 cm").
INSERT INTO pizza_size_presets (scope, country, size_label, shape, diameter_cm, source, notes, created_by) VALUES
  ('country','India','small',  'round',19,'manual','seed: India chains, regular 18-20 cm','seed'),
  ('country','India','regular','round',19,'manual','seed: India chains, regular 18-20 cm','seed'),
  ('country','India','medium', 'round',25,'manual','seed: India chains','seed'),
  ('country','India','large',  'round',33,'manual','seed: India chains (La Pino''z large = 33 cm)','seed')
ON CONFLICT DO NOTHING;

-- Domino's / Pizza Hut style S 10" / M 12" / L 14" in US, Nigeria, Kenya, Philippines.
INSERT INTO pizza_size_presets (scope, country, size_label, shape, diameter_cm, source, notes, created_by)
SELECT 'country', c.country, s.size_label, 'round', s.d, 'manual', 'seed: S 10" / M 12" / L 14"', 'seed'
FROM (VALUES ('United States'),('Nigeria'),('Kenya'),('Philippines')) AS c(country)
CROSS JOIN (VALUES ('small',25.4),('medium',30.5),('regular',30.5),('large',35.6)) AS s(size_label, d)
ON CONFLICT DO NOTHING;

-- Argentina "pizza" (molde) ~ 8 porciones ~ 35 cm; Italy Neapolitan default ~ 30-33 cm.
INSERT INTO pizza_size_presets (scope, country, size_label, shape, diameter_cm, source, notes, created_by) VALUES
  ('country','Argentina','default','round',35,'manual','seed: pizza de molde, ~8 porciones','seed'),
  ('country','Italy',    'default','round',32,'manual','seed: Neapolitan default 30-33 cm','seed')
ON CONFLICT DO NOTHING;
