# sfincione-40417 — Pizza Price Index (price per area, from receipts)

> Snax: "A pizza price index based on what we get from our receipts. It needs to be per square
> centimeter or something so we can adjust for the different pizzas. We will have to go through and
> identify the diameter of all the pizzas."

## Goal

Turn the pizza line items on our GPP receipts into a size-adjusted price index ("what does a
standard pizza cost here?"), comparable across cities, countries, continents, and (from GPP 2027 on)
years. The hard part is getting a size for every pizza line. Build that pipeline first, with an
admin review queue for fast manual confirmation. Then compute the index and show it internally.
Make it public last.

---

## 1. What exists today (verified)

- **`payout_documents`** (`PayoutDocument`, `backend/prisma/schema.prisma` ~L2200) holds the receipts.
  `ocrLineItems` JSONB is `OcrLineItem[] = {name, qty, unitPrice, subtotal, category}`, with
  categories `pizza|drink|side|dessert|tax|tip|fee|other` (`backend/src/services/ocr.service.ts` L23-43).
  Prices are in the receipt's original currency. Per-doc FX is stored in
  `originalCurrency`/`exchangeRate` (mortadella-92103). `merchant` is **not** a column; it lives at
  `ocr_raw->'ocr'->>'merchant'`.
- **The existing "pizza-prices analytics aggregate"** is `GET /api/admin/payouts/pizza-prices`
  (`backend/src/routes/admin-payout.routes.ts` L3209-3405, formaggi-89172). It flattens
  `category='pizza'` lines from non-duplicate, eligible docs and returns a by-country
  **mean/min/max unit price in USD**. Nothing in the frontend calls it; it's curl-only. It has
  these problems:
  1. **No size adjustment.** A personal pan and an 18" pie count the same.
  2. **Wrong FX.** It multiplies by `payout.exchangeRate` (the parent payout's rate) instead of the
     doc's own `exchangeRate`. 498 of the 628 non-USD eligible receipts have a doc-level rate.
  3. It uses the **mean**, which outliers and OCR misreads pull around.
  4. It counts each line once, so a 50-pizza order counts the same as a 1-pizza order. That part is
     fine, but nothing stops one bulk receipt from dominating a country.

  **Decision:** the index **replaces** this endpoint. Phase 1 fixes its FX bug as a one-line drive-by.
  Phase 2 deletes it once `/api/admin/pizza-index/*` exists. It has no frontend consumers.
- **OCR pipeline.** Cheap-then-strong routing (`gpt-4o-mini` → `gpt-4o`, `getLlmModels()` in
  `backend/src/lib/privateConfig.ts`). `POST /api/admin/payouts/backfill-line-items` handles up to 50
  per call, looped by `backend/scripts/loop-backfill-line-items.cjs`. `retry-ocr` is per doc.
- **Review UI building blocks.** `ReceiptLightbox`
  (`frontend/src/components/payments-shared/ReceiptLightbox.tsx`) already takes an `editorPane`
  slot plus keyboard callbacks (`onVerifyShortcut`, `onBeforeNavigate`). That's exactly the shape a
  review queue needs. `ReceiptEditor.tsx` already edits line-item categories.
- **Underboss dashboard** (`frontend/src/pages/UnderbossDashboard.tsx`) has admin-only tabs (e.g.
  `fake-detection` is gated on `isAdmin`). The tab enum is in
  `components/underboss/underbossTableUrlState.ts`.

## 2. Real numbers (prod, read-only, 2026-10-27)

| Metric | Value |
|---|---|
| Receipt docs (`kind='receipt'`), total / non-dup and eligible | 1,018 / **797** (from 295 parties) |
| Eligible receipts with `ocr_line_items` | 439 (406 non-empty) |
| Eligible receipts **never line-item OCR'd** (`ocr_attempt_count=0`, items NULL) | **358**. The backfill was simply never run on them |
| Eligible docs with ≥1 `category='pizza'` line | **181 docs / 147 parties** |
| Pizza lines (sum of qty) | **678 lines (~5,100 pizzas)** |
| `other` lines (some are mis-categorized pizzas, e.g. SE "5 X Regina Margherita con bufala") | 708 |
| Stray category `beverage` (not in the enum) | 7 lines |
| Pizza lines with unitPrice 0 / qty ≥ 10 | 15 / 144 (bulk orders are common) |
| Merchant captured (`ocr_raw.ocr.merchant`) | 383 / 797 eligible (48%) |
| Receipts from big chains (Domino's/Pizza Hut/Papa John's/etc. by merchant) | **~10**. Chain lookup tables have low leverage |
| Event year of all eligible receipts | **2026 only**. No YoY data until GPP 2027 |
| Top currencies | USD 166, INR 102, NGN 62, EUR 52, MXN 33, PHP 30, ARS 24, LKR 22, BRL 20 (+ ~40 more) |
| Top countries | India 103, US 83, Nigeria 76, Mexico 33, Argentina 31, Philippines 30, Venezuela 22, Sri Lanka 22, Brazil 20 |
| `ocr_language` populated | 14 / 797. Unusable; infer language from text instead |
| Pizza photos (`kind='pizza'`) | 1,521 |

**How often a pizza line states its size** (regex over the 678 pizza lines):
- explicit inches (`14"`, `12 Inch`, `10" Inch`): **42 (6%)**
- explicit cm (`33 cm`): **11 (2%)**
- size word (`small/medium/large/XL/personal/regular/family/familiar/mega/LG/...`): **134 (20%)**
- slice wording: 12. Rectangular style words (sicilian/detroit/sheet/pan): 7

So **~72% of pizza lines carry no size cue at all.** Most diameters will come from a
pizzeria-level or country-level default plus a human, not from parsing.

Sample pizza line names, to ground the parsing rules:
`14" Shroom View` (UK) · `Pesto & Basil Veg Pizza (Large Serves 4, 33 cm)` (IN, La Pino'z) ·
`3 Cheese Pizza (12 Inch)` (IN) · `Queen Margherita (10" Inch)` (IN) ·
`Farm Fresh (Medium [Serve 2])` (IN) · `Personal Chicken Tikka Supreme` (IN) ·
`Signature Pizza 11" - Margherita` (MX) · `X Large New York` (CA) · `16" Italian` (CA) ·
`Family Supreme` / `S&R Supreme New York` (PH) · `Chic BBQ LG Promo` / `Double Medium Pizza` (KE) ·
`Pizza Large` (NG) · `Large Pan Pizza - Deluxe Cheese` (MY) · `Omnivore LG` / `5 Pepperoni LG` (US) ·
`MEGA JAMON (E)` (VE) · `P. Muzzarella` / `P. Fugazzeta` (AR) · `1/1 Calabresa com Mussarela` (BR) ·
`PIZZA SICILIENNE` (FR) · `6x 7. Cacciatore` (SE) · `Պիցցա` (AM) · `Pizzas` (BO, qty 25) ·
`Pizza Party` (IN, qty 47) · `Promoción Pizza Libre + 1 consumición x 50` (AR) · `Pizzas varias` (AR, lump sum).

Takeaways:
- Text is multilingual. Size tokens are mostly English abbreviations (`LG`, `Large`, `Personal`,
  `Family`, `XL`), plus `"`, `Inch`, `cm`, `Mega`, and `1/1` (BR "whole" pizza).
- There are many **bundles and lump sums** (all-you-can-eat, "Pizza Party ×47", "Pizzas varias")
  that can never be priced per area. They need an explicit exclude reason.
- Some prices look misread (e.g. ARS 70/pizza in 2026). Outlier flagging is mandatory.
- The same line sometimes appears twice across multi-receipt docs (VE `MEGA JAMON (E)`).
  Dedupe by `(url, normalized name, qty, unitPrice)`.

---

## 3. Unit / metric (decision)

- **Stored canonical:** `unit_price_usd / area_cm2`, i.e. USD per cm².
- **Headline display: "price of a standard 30 cm (≈12″) pizza"** = USD/cm² × 706.9 cm². Call it the
  **SPE price** (Standard Pizza Equivalent). Why:
  - "$0.0197/cm²" and "$1.97/100 cm²" mean nothing to a reader. "$13.90 per standard pizza" is
    readable instantly.
  - 30 cm is metric-native for most of our countries, and ≈12″ for the US (12″ = 729.7 cm², only 3%
    larger).
  - Secondary column: ¢/100 cm², for nerds.
- **Shapes.** Every line resolves to an area:
  - `round`: π·(d/2)²
  - `rect`: length × width. Covers Sicilian, Detroit, grandma, half/full sheet, al taglio,
    pizza-al-metro.
  - `slice`: `slice_fraction` × area of the parent pie (e.g. a NY slice = 1/8 of 18″).
    By-weight/by-the-cut lines are rect with measured dims, or excluded.
  - `other` (calzone, flatbread of unknown size, bundles): excluded with a reason. Not guessed.
- **Which money counts.** Only the pizza line's own price. **Exclude** drinks, sides, delivery
  fees, tips, and tax lines. Use the line price **as printed**: VAT-inclusive where that's the
  local convention, pre-tax in the US. That's what a customer sees on a menu, and allocating tax
  lines back would make the US artificially pricier.
  - **Discounts.** If the receipt has explicit discount lines, store both `unit_price_list` and
    `unit_price_net` (receipt-level discount allocated pro rata across pizza lines). **The index
    uses list price**, so it measures what pizza costs, not how well a host haggled. Net is kept
    for a "what we actually paid" view.
  - Free or zero-price lines are excluded.
  - Donations don't appear as pizza lines, so no special handling.
- **Currency.** Index in **nominal USD** via the doc's own `exchangeRate`, which is the rate at OCR
  time, about the event date. Also show the **local-currency SPE median** per country, which is
  meaningful inside one country and immune to FX swings. **No PPP in v1.** A "Pizza Purchasing
  Parity" vs. World Bank PPP / Big Mac comparison is a fun Phase 3 add-on, not a dependency.

## 4. Data model (decision: normalized tables, not JSON)

Extending the `ocrLineItems` JSON was rejected. That JSON is rewritten by 6 different code paths
(host upload `payout.routes.ts` L1453/L2383, admin PATCH L6162, backfill L6457, retry-ocr L6600,
admin add-attachment L7017). Verified sizes would be silently clobbered on any re-OCR, and the
index would need JSONB gymnastics. A normalized side table survives re-OCR and is trivially
indexable.

**Migration** `backend/prisma/migrations/sfincione-40417-pizza-price-index.sql` (idempotent,
`IF NOT EXISTS`, matching existing files). It creates three tables and enables RLS on each with no
policies. The backend connects as the table owner, and this keeps anon away per the 2026-10 RLS
audit.

```sql
-- sizes known for a pizzeria / chain / country / global size word
CREATE TABLE IF NOT EXISTS pizza_size_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('merchant','chain','country','global')),
  merchant_key text,          -- normalized merchant/chain name (lower, no punctuation)
  country text,               -- parties.country spelling
  size_label text NOT NULL,   -- normalized: 'personal','small','medium','large','xl','family','mega','slice', or a literal like '33cm'
  shape text NOT NULL CHECK (shape IN ('round','rect','slice')),
  diameter_cm numeric(5,1), length_cm numeric(5,1), width_cm numeric(5,1),
  slice_fraction numeric(4,3),
  source text NOT NULL CHECK (source IN ('manual','web','llm')),
  source_url text, notes text,
  created_by text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS pizza_size_presets_key
  ON pizza_size_presets (scope, coalesce(merchant_key,''), coalesce(country,''), size_label);

-- one row per pizza line on an eligible receipt
CREATE TABLE IF NOT EXISTS pizza_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES payout_documents(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  line_index int NOT NULL,                 -- index into ocr_line_items
  line_fingerprint text NOT NULL,          -- md5(lower(name)|qty|unitPrice); change => re-review
  raw_name text NOT NULL,
  merchant text, merchant_key text,
  qty numeric(8,2) NOT NULL,
  unit_price_list numeric(14,4) NOT NULL,  -- original currency
  unit_price_net numeric(14,4),
  currency char(3) NOT NULL,
  fx_rate numeric(18,8) NOT NULL,          -- copied from payout_documents.exchange_rate
  unit_price_usd numeric(12,4) NOT NULL,
  size_label text,
  shape text CHECK (shape IN ('round','rect','slice','other')),
  diameter_cm numeric(5,1), length_cm numeric(5,1), width_cm numeric(5,1), slice_fraction numeric(4,3),
  area_cm2 numeric(8,1),                   -- computed in backend on write (not a generated column; Prisma-friendly)
  style text,                              -- 'neapolitan','ny','pan','detroit','sicilian','thin','other' (optional)
  size_source text CHECK (size_source IN ('parsed','preset','llm','web','manual')),
  size_confidence numeric(3,2),
  preset_id uuid REFERENCES pizza_size_presets(id) ON DELETE SET NULL,
  verified_by text, verified_at timestamptz,
  excluded boolean NOT NULL DEFAULT false,
  excluded_reason text,                    -- 'bundle','lump_sum','not_pizza','zero_price','duplicate_line','unreadable','other'
  outlier_flag boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz,
  UNIQUE (document_id, line_index)
);
CREATE INDEX IF NOT EXISTS pizza_line_items_party ON pizza_line_items(party_id);
CREATE INDEX IF NOT EXISTS pizza_line_items_queue ON pizza_line_items(verified_at, excluded, size_confidence);

-- per-doc sync marker so the sweep knows what changed
CREATE TABLE IF NOT EXISTS pizza_line_sync (
  document_id uuid PRIMARY KEY REFERENCES payout_documents(id) ON DELETE CASCADE,
  items_hash text NOT NULL, synced_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pizza_size_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_line_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE pizza_line_sync   ENABLE ROW LEVEL SECURITY;
```

Add the matching Prisma models (`PizzaSizePreset`, `PizzaLineItem`, `PizzaLineSync`) and back-relations
on `PayoutDocument` and `Party`.

**Migration safety (CLAUDE.md):**
1. Apply the SQL to prod (pooler `DATABASE_URL`) **before** merging the PR that adds the Prisma
   models.
2. Run `npm --prefix backend run check:schema-drift` locally and confirm CI's `schema-drift.yml`
   passes.
3. The tables are brand new, so no existing query SELECTs them. Even so, merge only after the apply.

**Sync instead of hooking every writer.** A `syncPizzaLineItems(docIds?)` service compares
`md5(ocr_line_items::text)` against `pizza_line_sync.items_hash`. For each changed doc, it upserts
pizza lines by `line_index`:
- keeps the size/verification data if `line_fingerprint` is unchanged;
- resets `verified_*` and re-runs the size resolver if the fingerprint changed;
- deletes rows for lines that disappeared or are no longer `category='pizza'`.

The sweep runs at the start of the review-queue fetch and the index fetch. At ~1k docs it's a cheap
SQL comparison. It also has a manual "Re-sync" button. Duplicate/ineligible flags are **not**
copied; the index joins `payout_documents` live, so toggling a flag takes effect immediately. This
avoids touching the 6 write paths and keeps the risk of regressing the payout flow at zero.

## 5. Getting sizes — the pipeline

Resolver order. The first hit wins, and every hit records `size_source` and `size_confidence`.

1. **Parse (`parsed`, conf 0.95).** Pure TS in `backend/src/services/pizzaSize.service.ts` with unit
   tests.
   - Explicit dimensions: `(\d{1,2}(\.\d)?)\s*("|”|''|in\b|inch|pulgadas|pol)` → inches × 2.54;
     `(\d{2})\s*cm` → cm.
   - Rectangles: `(\d+)\s*[x×]\s*(\d+)\s*(cm|")`.
   - Slices: `slice|porción|porcion|rebanada|fetta|pedaço` → `shape='slice'`.
   - `1/1` (BR) means whole; `1/2` means half.
   - Sanity bounds: round diameters 15–60 cm. Outside that, drop the hit and fall through.
   - Size words are normalized into `size_label` but **not** converted to a diameter here:
     `personal|individual|chica|pequeña|small|sm|s` → small; `medium|mediana|med|md|m|regular` →
     medium; `large|grande|lg|lrg|l` → large; `xl|x-large|extra large|familiar|family|mega|jumbo|gigante` → xl/family.
     Single-letter tokens (`L`, `M`, `S`) count only when they stand alone after a pizza name.
2. **Preset lookup (`preset`, conf 0.85 merchant / 0.8 chain / 0.6 country / 0.5 global).** Match
   `(merchant_key, size_label)`, then chain, then `(country, size_label)`, then global. A missing
   size_label for a known single-size merchant (e.g. a Neapolitan place that only does ~30 cm) can
   be a merchant preset with `size_label='default'`.
   - **Seed globals:** small 25 cm, medium 30 cm, large 35 cm, xl/family 40 cm, personal 20 cm,
     slice = 1/8 of 45 cm.
   - **Seed country rows** where they differ. India chains: regular 18–20 / medium 25 / large 33
     cm (La Pino'z prints "Large Serves 4, 33 cm"). Domino's/Pizza Hut in US/NG/KE/PH: S 10″, M
     12″, L 14″. Argentina "pizza" (molde) ≈ 8 porciones ≈ 35 cm. Italy/EU Neapolitan default ≈
     30–33 cm.
   - The ~10 chain receipts get chain rows. Effort goes into **merchant presets**: the 383 receipts
     with a merchant collapse to roughly 300 merchant keys, and confirming one line from a merchant
     fills that merchant's other lines.
3. **LLM text pass (`llm`, conf = model-reported, capped 0.7).** One batch job with `gpt-4o-mini`
   (`getLlmModels().assistant`). Input per receipt: merchant, country, city, currency, and all line
   names + prices. Output per line:
   `{isPizza, sizeLabel, shape, diameterCm|null, lengthCm, widthCm, sliceFraction, isBundle, style, reasoning≤80ch}`.
   - Covers the 678 pizza lines **and** re-classifies the 708 `other` lines plus the 7 `beverage`
     lines.
   - Writes `isPizza=true` hits as new `pizza_line_items` with `size_source='llm'`, unverified. It
     does not rewrite `ocrLineItems` categories; the payout flow stays untouched.
   - Cost: ~230 receipts × ~1.5k tokens ≈ 350k in / 60k out ≈ **< $0.15**.
4. **Vision pass for still-unknown lines (`llm`, conf ≤ 0.75), opt-in per batch.** Re-send the
   receipt image to `gpt-4o` with a size-focused prompt ("for each pizza line, any printed size,
   diameter, or slice count"). Bounded to receipts that still have an unresolved line after steps
   1–3.
   - Cost: ≤ ~200 images × ~$0.01–0.02 ≈ **$2–4**.
   - Also captures `merchant` where it was null.
5. **Web lookup (`web`), Phase 1.5, optional.** For the top merchants by line count, an
   admin-triggered "Look up menu" button. It asks an LLM with web search for that pizzeria's size
   chart and creates an **unverified** merchant preset with `source_url`. It is never auto-verified.
   Recommend deferring until the review queue shows how many merchants actually stay unknown.
6. **Pizza photos.** Not used for automatic estimation; diameter estimates from photos without a
   reference object are unreliable. The review pane shows the party's `kind='pizza'` photos as
   context only (a box with a 12-pack of slices is a strong hint).

**Going forward.** Extend the OCR system prompt (`ocr.service.ts` L130-160 and the multi-receipt
prompt) so each `lineItems[]` entry may include an optional `size: {label, diameterCm, lengthCm,
widthCm}`. Update `sanitizeLineItems` to keep it (optional field, so backwards-compatible). New
receipts then feed step 1 directly. Also add `beverage` → `drink` normalization in the sanitizer.

**Prerequisite (Phase 1, step 0).** Run the existing `loop-backfill-line-items.cjs` over the **358
never-attempted eligible receipts**. Cost ≈ $4–7 of gpt-4o-mini, escalating to 4o. That roughly
doubles the receipts with line items and probably adds ~150 pizza docs.

## 6. Admin review queue (Phase 1 UI)

- **Where:** a new admin-only Underboss tab **`pizza-index`**, gated like `fake-detection`, with two
  sub-views: **Review** (Phase 1) and **Index** (Phase 2). Add the tab to `UnderbossTab` and the
  URL-state helper.
- **Queue list:** rows grouped by receipt and ordered by (unverified, lowest confidence, highest qty
  first). Filters: country, merchant, source, `outlier_flag`, excluded. A progress bar shows
  verified / total lines and verified **pizza count** (qty-weighted).
- **Review modal:** `ReceiptLightbox` with `editorPane={<PizzaSizeEditor/>}`. The pane lists the
  receipt's pizza lines with a prefilled guess, a source badge, and confidence. Each line has:
  - shape toggle;
  - diameter input in **in or cm**, toggleable and remembered per country;
  - quick-pick chips (20/25/30/33/35/40/45 cm and 10/12/14/16/18″);
  - live computed area and **SPE price**, so a misread price is visible immediately;
  - exclude reason dropdown;
  - "apply to all lines from this merchant with this size label", which creates/updates a merchant
    preset and re-resolves sibling lines (still unverified, conf 0.85).

  Uses `IconInput` for inputs and `Checkbox` for toggles, per the CLAUDE.md component rules.
- **Keyboard:**
  - `j/k` next/prev line; `Enter` accept the guess (verify);
  - `1–7` quick-pick chip; `r/s/x` shape round/rect/slice;
  - `e` exclude (then a digit picks the reason); `m` apply to merchant;
  - `→/←` next/prev receipt. Wire receipt navigation through the existing `onVerifyShortcut` and
    `onBeforeNavigate`.
- **Estimated labor:** ~700–1,200 lines after backfill and LLM. With merchant propagation, maybe
  ~400 distinct decisions at ~5–10 s each, so **≈1–2 hours of reviewing**. It can be split across
  regional underbosses later; the endpoints accept `requireAnyAdminOrPaymentAdmin`.

**Backend** (`backend/src/routes/pizza-index.routes.ts`, mounted at `/api/admin/pizza-index` before
the `/api/admin` catch-all in `backend/src/index.ts`, `requireAuth` + `requireAnyAdminOrPaymentAdmin`):

| Endpoint | Purpose |
|---|---|
| `POST /sync` | run `syncPizzaLineItems` + resolver steps 1–2 on new/changed lines |
| `POST /llm-pass` | step 3, `{limit}` batched like backfill-line-items; idempotent (skips lines with `size_source` ≥ llm) |
| `POST /vision-pass` | step 4, `{limit}`, opt-in |
| `GET /queue` | paginated review queue with doc URL/mime/fileName for the lightbox + party pizza photo URLs |
| `PATCH /lines/:id` | set size/shape/exclude, verify; recompute `area_cm2`; `verified_by=email` |
| `POST /lines/:id/apply-to-merchant` | upsert merchant preset + re-resolve siblings |
| `GET/POST/PATCH /presets` | preset CRUD (small table view in the Review sub-view) |
| `GET /index` | Phase 2 aggregates (below) |

## 7. Index computation (Phase 2)

- **Eligible rows.** `pizza_line_items` joined to `payout_documents` and `parties`, kept when:
  - the doc is not a duplicate and not ineligible;
  - the line is not excluded;
  - `area_cm2 > 0` and `unit_price_usd > 0`;
  - `(verified_at IS NOT NULL OR size_confidence >= 0.8)`.

  Add a toggle "verified only" vs "verified + high-confidence". Both are reported with n.
- **Observation unit and weighting.** Compute `usd_per_cm2` per line. Then:
  1. **party SPE** = qty-weighted median over that party's lines;
  2. each higher level (city, country, continent, global) = **median of party SPEs**.

  One 50-pizza receipt then can't dominate its country, and every event counts once. Robust and easy
  to explain.
- **Outliers.** On log(usd_per_cm2), any line > 3.5 MAD from its country median, or outside the
  global [$0.002, $0.20]/cm² sanity band, gets `outlier_flag=true` and is **routed back into the
  review queue**. It is excluded from the index only if unverified. A human-verified outlier stays
  in; it's real.
- **Minimum samples.** Publish a city or country value only with **≥ 3 parties**; otherwise show
  "n<3" greyed. Continent needs ≥ 10. Always display n(parties), n(lines), and n(pizzas). Expect
  country to be the main grain: 147 parties now, probably ~250 after backfill, across ~70
  countries, so most cities have n = 1.
- **Dimensions.** Global, continent (reuse the region mapping the Underboss dashboard already uses),
  country, city, merchant, style, size bucket (does price/cm² fall with size? It should, and that's a
  nice chart), and event series / year.
- **YoY.** Group by `parties.event_series_id` (gpp2026, gpp2027). Show "2026 → 2027 % change" per
  country in USD and in local currency. Local currency is the honest inflation read; USD mixes in FX
  moves. Empty until GPP 2027 receipts exist.
- **Where computed.** Plain SQL with `percentile_cont` in the backend, wrapped in a 5-minute
  in-memory cache keyed by filters. The data is tiny (< 5k rows), so a **materialized view is not
  worth it**: it adds refresh plumbing and would make verify→index lag confusing during review. A
  normal SQL **view** `pizza_price_index_lines` (the eligible-rows join above) keeps the filter logic
  in one place and is reusable by Phase 3.

## 8. Surface

- **Phase 2, internal.** Underboss → Pizza Index → **Index** sub-view:
  - country table: SPE USD median, local-currency median, IQR, n parties/lines/pizzas, % verified;
  - drill-down to cities and merchants, then lines (click opens the receipt in the lightbox);
  - small charts: price/cm² vs diameter scatter, continent bars;
  - CSV export.
- **Phase 3, public `/pizza-index`.** Add the route before `/:slug` in `App.tsx`.
  - Map + leaderboard: "cheapest/priciest standard pizza by country", global median, methodology
    blurb.
  - A public endpoint `GET /api/pizza-index` returns **aggregates only**: n ≥ 3 parties, no party
    names, merchants, or receipt images. It is cached for 1 h.
  - Reuse the GPP map component used by `/gpp/pizzerias`. Use `Layout`.
  - Optional: OG image, plus a "Pizza Purchasing Parity" comparison vs Big Mac / PPP.

## 9. Phasing (each phase shippable)

**Phase 1 — data + sizes + review queue** (branch `sfincione-40417-pizza-index`)
0. Run line-item backfill over the 358 un-OCR'd eligible receipts. Ops only, no code.
1. Migration SQL → **apply to prod** → Prisma models → drift check.
2. `pizzaSize.service.ts` (parser + resolver + normalizer) with Vitest tests built from the real
   sample strings in §2.
3. `pizzaLineSync.service.ts` (hash-based sync) + presets seed (global + the country rows in §5).
4. `pizza-index.routes.ts`: sync, llm-pass, vision-pass, queue, line PATCH, apply-to-merchant,
   presets.
5. Frontend: `UnderbossTab` `pizza-index`, `components/underboss/PizzaIndexTab.tsx` (Review
   sub-view + presets table), `PizzaSizeEditor.tsx` as the lightbox `editorPane`, API functions in
   `frontend/src/lib/api.ts`, types in `frontend/src/types.ts`.
6. OCR prompt: optional per-line `size` + `beverage→drink` normalization. Fix the `/pizza-prices`
   FX bug (use `doc.exchangeRate ?? payout.exchangeRate`).
7. Ops: run sync → llm-pass → Snax/underbosses review.

**Phase 2 — index + internal dashboard**
- `pizza_price_index_lines` view (second migration, applied to prod first), `GET /index` with
  levels/filters, outlier flagging job, and the Index sub-view.
- Delete `/pizza-prices`.

**Phase 3 — public page**
- `GET /api/pizza-index` (aggregates only) and the `/pizza-index` page with map + table +
  methodology.

## 10. Risks

- **Coverage is thin** (147 parties with pizza lines today). Mitigation: backfill first, LLM
  re-classify `other`, and show n everywhere. Accept that country is the finest reliable grain this
  year.
- **OCR price misreads** (wrong magnitude, qty/unit swapped). Mitigation: the live SPE preview in
  the editor plus outlier routing. The editor can also fix `qty`/`unit_price_list` on the
  `pizza_line_items` row (stored as overrides there, never written back to `ocrLineItems`).
- **Size guesses masquerading as data.** Mitigation: provenance + confidence on every row, and a
  "verified only" toggle. The public page uses verified + high-confidence only and states the
  methodology.
- **Tax inconsistency** (VAT-inclusive vs US pre-tax). Documented; it biases the US ~5–10% cheaper.
  Optional later: a per-country `tax_included` flag with a gross-up.
- **Payout flow regression.** Avoided by design: the side tables and sync sweep make no writes to
  `payout_documents`. The only touch is the additive OCR prompt field, which is optional and
  sanitized.
- **RLS.** New tables get RLS enabled with no policies. Verify with an anon `select` via REST that
  they return nothing, per the RLS-audit pattern.
- **Schema drift.** Two migrations (Phase 1 tables, Phase 2 view). Each is applied to prod before
  its merge.

## 11. Verification

- **Unit:** `pizzaSize.service.test.ts` covers every §2 sample string → expected `{label, shape,
  diameterCm}`. Also inch/cm/rect/slice parsing, bounds, single-letter guarding, and preset
  precedence. `pizzaLineSync` test: an unchanged fingerprint keeps verification; a changed one
  resets; a removed line is deleted.
- **Backend:** `npm --prefix backend run build` + tests. `check:schema-drift` green against prod
  after the apply.
- **Lint gate:** `rules-of-hooks` over the new components (`lint.yml`).
- **Prod data sanity (read-only SQL after ops runs):**
  - count of pizza lines by `size_source`;
  - % verified;
  - no `area_cm2` outside 100–3,000 for round;
  - SPE spot checks: US NY-style should land around $12–20; India chain large around $4–7.
- **Vercel preview** (`https://rsvpizza-git-sfincione-40417-pizza-index-pizza-dao.vercel.app/underboss?tab=pizza-index`).
  The backend only deploys from master, so the Phase 1 backend must merge, after the migration is
  applied, before the preview UI has data. Alternatively ship backend-first in its own PR.
  - Queue loads, the lightbox opens with the receipt + editor pane, and keyboard flow works
    (Enter verifies and advances).
  - Apply-to-merchant re-resolves siblings; excluded lines vanish from the queue.
  - Phase 2: country table numbers match a hand SQL query for 2–3 countries.
  - Run `/mobile-check` on the public page in Phase 3.

## 12. Decisions (Snax, 2026-10-27) — these override anything above

1. **Display:** show **raw USD/cm²** (and local/cm²) up front, **plus** prices for standard sizes:
   25 cm (≈10″), 30 cm (≈12″), 35 cm (≈14″), 40 cm (≈16″) = USD/cm² × each area. No single
   "SPE" headline; the size-ladder columns replace it everywhere (internal + public).
2. **Price basis:** index on **menu/list price**. Record discounts: keep `unit_price_net` and the
   receipt's discount lines (amount + label) so a "what we paid" view and discount stats exist.
3. **Reviewers:** everyone — superadmins, payments admins, and underbosses. Underbosses see/edit
   only lines in their scope (reuse the mozzarella-25815 city/region scoping). Tab is no longer
   admin-only; record `verified_by` for each edit.
4. **Bundles / all-you-can-eat:** **show them**, don't drop them. Flag `is_bundle` instead of
   `excluded_reason='bundle'`; list them in their own "Bundles & deals" section with total price,
   qty, and per-pizza price where qty + size are known. They're excluded from the core medians by
   default, with an "include bundles" toggle on the index views.
5. **LLM/vision spend approved** (~$5–10). Use the site's existing OpenAI key (backend
   `OPENAI_API_KEY`, same client as ocr.service). Web menu lookup stays deferred.
6. **Public page: yes**, launch with GPP 2026 data (no waiting for 2027).
7. **PR split: yes** — Phase 1 ships as PR A (backend + migration, merged after the prod apply)
   then PR B (review UI), so the preview has live data.
