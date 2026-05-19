# supreme-43217: Blockchain-city coverage gap analysis for GPP 2026

**Priority**: P2
**Type**: Analytic script (no Vercel preview, no frontend, no migration)

## Problem

PizzaDAO is heading into GPP 2026 (Global Pizza Party) outreach season. We need a data-driven list of cities to recruit hosts from. Today there is no programmatic way to answer: *"Which cities have an active blockchain/web3 community but no GPP party planned for 2026?"* Underbosses are reaching out city-by-city from intuition.

This task delivers a one-shot ranking script Snax runs locally. Output is a Google Sheet with the top 200 candidate cities ranked by `population × web3_activity_score × (1 - has_gpp_party)`. The sheet feeds Task B (`stagioni-29104` scrapers) and Task C (`marinara-67583` outreach admin tab).

## Approach

A standalone Node script at `scripts/outreach/coverage-gap-2026.cjs`. It:

1. Connects to Postgres via `pg` (DATABASE_URL from `.env`) — matches the pattern in `backend/scripts/restore-mc-deletions.cjs` since the Supabase admin token is unreliable.
2. Pulls all `parties` rows with `event_type='gpp'` whose `date` falls in 2026.
3. Extracts the city from each party's `name` (parties has no `city` column — confirmed against `backend/prisma/schema.prisma` lines 40-215 on master; only `address`, `country`, `region`, `latitude`, `longitude`, `placeId` exist). Reuses the regex `/Global Pizza Party\s+(.+)/i` already used in `frontend/src/components/underboss/CitiesTable.tsx` lines 123-133.
4. Normalizes those city names (lowercase, strip diacritics, collapse whitespace) — same `normalize` helper as CitiesTable lines 118-120.
5. Loads a static world-cities-with-population dataset from disk.
6. Joins normalized GPP city names against the world-cities list using exact-on-normalized-name + country to find which cities have coverage.
7. Annotates each city with a curated `web3_score` (seed list of ~45 known web3 cities, 1-10).
8. Computes the weighted score, ranks, takes top 200.
9. Writes the result to a Google Sheet via the Sheets API (OAuth refresh token from `~/.claude/CLAUDE.md` gdrive section — same creds Snax already uses).

The script is **idempotent** — re-running creates a new sheet (or overwrites the configured sheet by ID, controlled by a CLI flag).

## Coverage cutoff decision

**Recommend: any 2026 GPP event regardless of `underboss_status`.** Rationale: an event that's `pending` or `listed` still represents a host who has self-organized; we don't want to double-recruit. Treat them as "covered." Add a `coverage_status` column to the sheet so Snax sees the distinction (`approved` / `listed` / `pending` / `none`).

The CLI takes `--coverage-mode={any|approved-only}` defaulting to `any` so Snax can override.

## Data sources

### Parties query

```sql
SELECT id, name, country, region, address, date, underboss_status
FROM parties
WHERE event_type = 'gpp'
  AND date >= '2026-01-01'
  AND date < '2027-01-01';
```

City is derived from `name` via the existing GPP regex. Parties whose name doesn't match the regex are logged to stderr and skipped (with count).

### Population dataset

**Use GeoNames `cities15000.txt`** (all cities >15k population, ~26k rows, ~3MB).

- URL: `https://download.geonames.org/export/dump/cities15000.zip`
- License: Creative Commons Attribution 4.0 (must attribute "GeoNames" in the sheet footer)
- Columns we need: `name` (col 2), `asciiname` (col 3), `alternatenames` (col 4), `country_code` (col 9, ISO2), `population` (col 15)
- We ship `scripts/outreach/data/cities15000.txt` checked into the repo (3MB is acceptable; alternative is a `--download` flag that fetches at runtime).

Reasoning over `cities1000.txt` (~150k rows, 12MB): 15k threshold drops villages we'd never target and keeps the file small. Anything under 15k pop is irrelevant for web3 community recruitment.

ISO2 country codes need translation to the country names used in `parties.country`. Ship a small `iso2-to-country.json` lookup derived from GeoNames `countryInfo.txt`.

### Web3 activity seed

`scripts/outreach/data/web3-cities-seed.json` — curated list of ~45 cities with `{ city, country, web3_score }` where score is 1-10.

```
NYC 10, SF 10, Berlin 10, Singapore 10, London 10, Lisbon 9,
Dubai 9, Buenos Aires 9, Seoul 9, Tokyo 9, Bangalore 8, Mumbai 8,
Mexico City 8, Bogota 7, Nairobi 7, Lagos 8, Cape Town 7, Istanbul 8,
Tel Aviv 8, Warsaw 7, Prague 7, Tallinn 7, Toronto 8, Vancouver 7,
Austin 9, Miami 9, Denver 7, Chicago 7, Boston 7, Los Angeles 8,
Paris 8, Amsterdam 8, Zug 8, Zurich 7, Hong Kong 8, Taipei 7,
Bangkok 7, Ho Chi Minh 7, Manila 7, Jakarta 7, Sydney 7, Melbourne 7,
Auckland 6, Sao Paulo 8, Rio 7, Medellin 7
```

Cities in the GeoNames dataset that are absent from the seed get `web3_score = 0` and will rank near the bottom (weighted score = 0). This is intentional for v1.

**v2 hook**: The score column is computed by a single function `getWeb3Score(cityKey, country)`. In Task B, this function will be replaced with a Postgres query that sums event counts from `outreach_communities` per city. Document this in a comment at the top of the score function.

## City normalization

Single helper module: `scripts/outreach/lib/normalize-city.cjs`.

```
function normalize(s) {
  return s.normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
function cityKey(city, countryIso2) {
  return `${normalize(city)}|${countryIso2.toUpperCase()}`;
}
```

Matching strategy when joining GPP city -> GeoNames row:

1. Build a multi-index from GeoNames: `name`, `asciiname`, and each entry in `alternatenames` -> all map to the row's cityKey.
2. For each GPP city, look up: (a) exact normalized name + country, (b) normalized name only across all countries (warn on ambiguous), (c) substring containment if length >= 5.
3. Unmatched GPP cities log a warning with the raw + normalized form. Snax can manually correct these by adding entries to `scripts/outreach/data/city-aliases.json` (optional override file: `{"gpp_name": "geonames_name|US"}`).

Decision: **no Google Maps Places API for v1.** Pure text matching against GeoNames will resolve >95% of our ~150 GPP events. Ambiguous cases get manual review.

## Scoring formula

```
weighted_score = log10(population) * web3_score * (has_gpp_party ? 0 : 1)
```

Using `log10` instead of raw population so Tokyo (37M) doesn't dwarf Lisbon (550k). Multiplier rationale: a 9-score city of 500k (e.g., Lisbon) scores `log10(500000) * 9 = 51.3` vs a 0-score city of 37M = 0. Cities with coverage are zeroed out (the `(1 - has_gpp_party)` factor) so they never appear in the top 200 — but they're still logged for QA in a second tab.

## Output

**Google Sheet** created via the Sheets API.

Default behavior: create a new spreadsheet named `GPP 2026 Coverage Gap — YYYY-MM-DD`. Override with `--sheet-id=<id>` to write to an existing sheet (replaces existing rows).

Auth: load `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` from `.env` (or fallback to the values documented in the global `~/.claude/CLAUDE.md` gdrive section). Scope: `https://www.googleapis.com/auth/spreadsheets` plus `https://www.googleapis.com/auth/drive.file` to allow creating new spreadsheets.

Use the official `googleapis` npm package. Add as a dev dependency in the root `package.json`.

### Sheet structure

**Tab 1: `Top 200 Gap Cities`** — columns:

| rank | city | country | population | web3_score | has_gpp_party | coverage_status | weighted_score | notes |
|---|---|---|---|---|---|---|---|---|

**Tab 2: `Covered Cities`** — every GPP-covered city for QA, columns: `city, country, gpp_party_slug, gpp_party_date, underboss_status, web3_score`.

**Tab 3: `Unmatched GPP Events`** — GPP events whose city couldn't be resolved to GeoNames, for manual cleanup.

**Tab 4: `Run Metadata`** — single row with: run timestamp, parties query count, geonames row count, unmatched count, coverage-mode flag, attribution note ("City data CC-BY GeoNames").

Print sheet URL to stdout at end of run.

## Files to create

- `scripts/outreach/coverage-gap-2026.cjs` — main script (~400 lines)
- `scripts/outreach/lib/normalize-city.cjs` — normalize + cityKey helpers (~30 lines)
- `scripts/outreach/lib/load-geonames.cjs` — parse cities15000.txt into in-memory index (~80 lines)
- `scripts/outreach/lib/sheets-writer.cjs` — googleapis OAuth + write helpers (~120 lines)
- `scripts/outreach/data/cities15000.txt` — checked-in GeoNames dump (~3MB)
- `scripts/outreach/data/iso2-to-country.json` — ISO2 -> country-name lookup (~250 rows)
- `scripts/outreach/data/web3-cities-seed.json` — curated seed scores (~45 entries)
- `scripts/outreach/data/city-aliases.json` — empty initially, Snax-editable manual overrides
- `scripts/outreach/README.md` — usage, CLI flags, attribution, score schema, v2 plan-B hook

Root `package.json` gets `googleapis` added to `dependencies`.

## Step-by-step implementation

1. **Add dep**: `npm install googleapis` in repo root. Confirm `pg` and `dotenv` already present.
2. **Data files**: Download and check in `cities15000.txt` from GeoNames. Generate `iso2-to-country.json` from `countryInfo.txt` (one-time). Write `web3-cities-seed.json` from the spec in this plan.
3. **Helpers**: Write `lib/normalize-city.cjs` (mirrors CitiesTable normalization). Write `lib/load-geonames.cjs` — streams the TSV, builds two maps: `byKey: Map<cityKey, row>` and `byNormName: Map<normName, row[]>` (for ambiguity detection).
4. **Sheets helper**: Write `lib/sheets-writer.cjs` exposing `createSpreadsheet(title, tabs)` and `writeTab(sheetId, tabName, rows)`. Use OAuth2 client + refresh token flow. Both functions accept 2D arrays.
5. **Main script**:
   - Parse CLI flags (`--coverage-mode`, `--sheet-id`, `--dry-run`, `--limit=200`).
   - Connect to Postgres, run parties query.
   - For each party: extract city via GPP regex, normalize, look up in GeoNames index. Build `coveredKeys: Set<cityKey>` and `gppEventsByKey: Map<cityKey, party[]>`.
   - Iterate GeoNames rows: for each, look up web3 score from seed (via cityKey), compute `has_gpp_party = coveredKeys.has(cityKey)`, compute weighted score.
   - Sort by weighted_score desc, slice top 200.
   - Build the 4 tab payloads.
   - If `--dry-run`: print top 20 as a table and exit.
   - Otherwise: call `createSpreadsheet` (or `writeTab` if `--sheet-id` given), print final URL.
6. **README**: Document the CLI, the GeoNames attribution requirement, the seed-score schema, how to edit `city-aliases.json`, and the v2 hook for Task B integration.

## Verification

- **Dry-run**: `node scripts/outreach/coverage-gap-2026.cjs --dry-run` prints the top 20 ranked cities to stdout. Confirm known-web3 cities without GPP coverage (e.g., if Denver has no 2026 GPP, it should appear high).
- **Sanity bounds**: NYC, SF, Berlin must NOT appear in top 200 (they have GPP coverage every year).
- **Unmatched threshold**: Tab 3 (`Unmatched GPP Events`) should have <10 rows. If higher, add aliases.
- **Live run**: `node scripts/outreach/coverage-gap-2026.cjs` creates a sheet. Open URL, verify: 4 tabs present, 200 rows in tab 1, GeoNames attribution in tab 4, weighted_score column monotonically decreasing in tab 1.
- **Spot-check**: For 5 random top-50 cities, manually verify (a) the city actually has a web3 scene per Twitter/Lu.ma, (b) there's no GPP 2026 event for that city in the admin dashboard.
- **Coverage-mode toggle**: Run with `--coverage-mode=approved-only`, confirm row count in Tab 2 drops to only approved parties and top 200 in Tab 1 shifts accordingly.

## Out of scope (handed off to other tasks)

**Handed to `stagioni-29104` (Task B):**
- All scraping (lu.ma, meetup, curated lists, X handles).
- `outreach_communities` table + migration.
- Replacing the static seed score with scraper-derived per-city event/community counts.
- Cross-referencing scraped data with this gap list.

**Handed to `marinara-67583` (Task C):**
- `/underboss/outreach` admin tab.
- `outreach_attempts` table.
- DM/email templates and send tracking.
- Surfacing the gap-sheet rankings inside the admin UI.

**Not in any task right now (future):**
- Promoting the seed list to a `cities` table in Postgres (intentionally avoided — keep this script-only for one-shot use).
- Recurring/scheduled runs (one-shot only; Snax re-runs as needed).
- Google Maps Places API enrichment for ambiguous city matches (text matching is sufficient for v1).

### Critical files for implementation

- `backend/prisma/schema.prisma` (Party model lines 40-215; confirms no `city` column, has `name`, `country`, `region`, `date`, `eventType`, `underbossStatus`)
- `frontend/src/components/underboss/CitiesTable.tsx` (city extraction regex + normalize helper to reuse, lines 118-157)
- `backend/scripts/restore-mc-deletions.cjs` (pg + DATABASE_URL script pattern to mirror)
- `scripts/migrate-gpp-slugs.js` (existing `extractCity` from event name, lines 22-33)
- `package.json` (root deps — add `googleapis`)

---

## Adjustments applied during implementation

- **`parties.city` IS a real column** as of migration `supabase/migrations/20260518_add_parties_city.sql` (stuffed-crust-29607). The script's SQL now `SELECT`s `city` and uses it as the primary source, falling back to the regex extraction when `city` is `NULL` (older rows).
- **Web3 seed = 30 entries** (not 45). Snax will expand later. The 30 entries are the highest-priority cities from the plan list: NYC, SF, Berlin, Singapore, London, Lisbon, Dubai, Buenos Aires, Seoul, Tokyo, Bangalore, Mumbai, Mexico City, Bogota, Lagos, Tel Aviv, Toronto, Austin, Miami, Los Angeles, Paris, Amsterdam, Zug, Hong Kong, Taipei, Bangkok, Sydney, Sao Paulo, Medellin, Istanbul.
