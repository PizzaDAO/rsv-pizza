# stagioni-29104: Outreach community scrapers + cross-reference

**Priority**: P2
**Type**: Backend migration + scripts (small PR — no frontend, no API routes)

## Problem

GPP 2026 has world-wide coverage gaps — cities with active crypto / web3 communities but no host signed up. Recruiting hosts there manually is slow; we need a structured contact list. Task supreme-43217 ranks gap-cities. Task marinara-67583 builds the admin outreach UI. This task is the data-collection middle layer: scrape four public sources of community handles, store them in a new `outreach_communities` table, and cross-reference against supreme-43217's gap list to produce a prioritized contact list that marinara-67583 will consume.

## Approach

- One new admin-only table: `outreach_communities`. Service-role-key access only — backend bypasses RLS, no `GRANT` to `anon`/`authenticated` (mirrors the `sponsor_users` pattern in `supabase/migrations/20260403_sponsor_dashboard.sql`).
- Four standalone CommonJS scripts under `scripts/outreach/scrapers/`, each idempotent via `ON CONFLICT (source, contact_url) DO UPDATE` with manual-edit guards (priority/notes are never overwritten by scrapers).
- One cross-reference script that reads supreme-43217's published Google Sheet, fuzzy-joins on normalized city, scores entries, and writes back `priority`. Posts a top-N summary tab to the same sheet.
- Use existing root-level deps only: `pg` (already in root `package.json`) + `@supabase/supabase-js` (in `backend/package.json`). No new HTTP scraping libs — use Node 20's built-in `fetch` for HTTP and a tiny inline regex-based HTML extractor (the four target sources do not require JS execution; lu.ma and meetup expose JSON in `<script id="__NEXT_DATA__">` and a GraphQL endpoint respectively).
- Cache HTTP responses to `.cache/outreach/` (git-ignored) so re-runs during dev don't re-hit rate-limited public endpoints.

**ToS / legal posture**: lu.ma, meetup.com, and x.com Terms of Service prohibit automated scraping. The scope here is limited to public organizer/community handles — no member lists, no DMs, no auth-required data. Plan inline notes warn the operator to:
- Run scrapers from a personal residential IP, **not** from Vercel / CI.
- Throttle aggressively (1 req/sec with jitter).
- Treat lu.ma + meetup output as best-effort; if scrapers break due to markup changes, fall back to the curated seed list.
- Skip the X scraper entirely if it returns login-walls — flag X handles for manual triage.

## Database changes

### Migration

File: `supabase/migrations/20260519_create_outreach_communities.sql`

```sql
-- stagioni-29104: Outreach community staging table
-- Admin-only — no anon/authenticated GRANTs. Backend reads via service_role.
-- Mirrors the sponsor_users access pattern from 20260403_sponsor_dashboard.sql.

CREATE TABLE outreach_communities (
  id              TEXT PRIMARY KEY DEFAULT (
    -- cuid-compatible: matches the User.id default (cuid())
    -- Prisma will write its own cuid() values when inserts come via the client.
    -- For raw-SQL inserts from scraper scripts, generate the cuid in JS.
    gen_random_uuid()::text
  ),
  city            TEXT NOT NULL,
  country         TEXT,
  community_name  TEXT NOT NULL,
  source          TEXT NOT NULL,            -- 'luma' | 'meetup' | 'curated' | 'twitter'
  contact_handle  TEXT,
  contact_url     TEXT NOT NULL,
  contact_email   TEXT,
  follower_count  INT,
  activity_score  NUMERIC(10, 4),
  priority        TEXT,                     -- 'high' | 'medium' | 'low' | null
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT outreach_communities_source_check
    CHECK (source IN ('luma', 'meetup', 'curated', 'twitter')),
  CONSTRAINT outreach_communities_priority_check
    CHECK (priority IS NULL OR priority IN ('high', 'medium', 'low'))
);

CREATE UNIQUE INDEX idx_outreach_communities_source_url
  ON outreach_communities (source, contact_url);

CREATE INDEX idx_outreach_communities_city_lower
  ON outreach_communities (lower(city));

CREATE INDEX idx_outreach_communities_priority
  ON outreach_communities (priority) WHERE priority IS NOT NULL;

-- Enable RLS but add NO permissive policies — service_role bypasses RLS,
-- and anon/authenticated have no GRANT so they cannot SELECT.
ALTER TABLE outreach_communities ENABLE ROW LEVEL SECURITY;

-- Trigger to maintain updated_at on every UPDATE
CREATE OR REPLACE FUNCTION set_outreach_communities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_outreach_communities_updated_at
  BEFORE UPDATE ON outreach_communities
  FOR EACH ROW
  EXECUTE FUNCTION set_outreach_communities_updated_at();

-- NOTE: deliberately no GRANT SELECT to anon/authenticated.
-- This table is admin-only. marinara-67583's /underboss/outreach route
-- will read it via service_role-key on the backend.
```

### Prisma schema

Append to `backend/prisma/schema.prisma` (style matches `Payout`, `SponsorUser`, `CityStatus`):

```prisma
// ============================================
// Outreach Communities (stagioni-29104)
// ============================================
// Admin-only staging table populated by scripts/outreach/scrapers/*.
// Joined against supreme-43217 gap analysis to produce prioritized
// contact list consumed by /underboss/outreach (marinara-67583).

model OutreachCommunity {
  id             String    @id @default(cuid())
  city           String
  country        String?
  communityName  String    @map("community_name")
  source         String    // 'luma' | 'meetup' | 'curated' | 'twitter'
  contactHandle  String?   @map("contact_handle")
  contactUrl     String    @map("contact_url")
  contactEmail   String?   @map("contact_email")
  followerCount  Int?      @map("follower_count")
  activityScore  Decimal?  @map("activity_score") @db.Decimal(10, 4)
  priority       String?   // 'high' | 'medium' | 'low'
  notes          String?

  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  @@unique([source, contactUrl])
  @@index([city])
  @@index([priority])
  @@map("outreach_communities")
}
```

### Order of operations (CRITICAL)

Per project memory ("backend goes live with new schema fast after master push; merging a Prisma field-add before the DB has the column = 500s on every query"):

1. **Apply migration to prod first** via `mcp__supabase-pizzadao__apply_migration` (name: `create_outreach_communities`, body = SQL above). Do this from the PR branch before requesting review.
2. **Verify** with `mcp__supabase-pizzadao__execute_sql`: `SELECT to_regclass('public.outreach_communities');` returns the table; `SELECT column_name FROM information_schema.columns WHERE table_name='outreach_communities';` returns the 13 expected columns.
3. **Then** merge the Prisma schema change to master. Backend redeploys with `prisma generate` already aware of the new model — no 500s because the column exists in prod.
4. **After merge**, operator pulls master and runs scrapers from their laptop (not Vercel).
5. **Then** runs cross-reference to populate `priority`.

Migration filename uses today's date prefix: `20260519_create_outreach_communities.sql` (per `20260519_seed_regional_optin_ab_flags.sql` precedent).

## Scrapers

All scripts are CommonJS (`.cjs`), follow the existing `scripts/backfill-*.js` shape:

- Shebang/header docblock with usage, env vars, dry-run vs apply
- `--apply` flag required to write; default is dry-run (print intended upserts)
- Required env: `SUPABASE_SERVICE_ROLE_KEY` (or `DATABASE_URL` for `pg`)
- HTTP via Node 20 built-in `fetch`. No new deps.
- Common helpers extracted to `scripts/outreach/lib/db.cjs`, `scripts/outreach/lib/cache.cjs`, `scripts/outreach/lib/normalize.cjs`.

### Common helpers (`scripts/outreach/lib/`)

- `db.cjs` — exports `upsertCommunity({ city, country, communityName, source, contactHandle, contactUrl, contactEmail, followerCount, activityScore })`. Uses raw `pg` Pool (matches root deps). Upsert SQL:

  ```sql
  INSERT INTO outreach_communities
    (id, city, country, community_name, source, contact_handle, contact_url,
     contact_email, follower_count, activity_score)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (source, contact_url) DO UPDATE SET
    city           = EXCLUDED.city,
    country        = EXCLUDED.country,
    community_name = EXCLUDED.community_name,
    contact_handle = EXCLUDED.contact_handle,
    contact_email  = COALESCE(EXCLUDED.contact_email, outreach_communities.contact_email),
    follower_count = EXCLUDED.follower_count,
    activity_score = EXCLUDED.activity_score
    -- NOTE: priority and notes are NOT in SET clause — manual edits are preserved.
  RETURNING (xmax = 0) AS inserted;
  ```

  The `id` is generated in JS (`crypto.randomUUID()` cast to text — matches the migration default).

- `cache.cjs` — `getCached(url, ttlMs)` writes responses to `.cache/outreach/<sha1(url)>.json` with `{ fetchedAt, status, body }`. Returns cached body if within TTL (default 24h). Honor `--no-cache` CLI flag.

- `normalize.cjs` — `normalizeCity(raw)` lowercases, strips accents (via `String.prototype.normalize('NFD').replace(/\p{Diacritic}/gu, '')`), collapses whitespace. Used for the upsert and for cross-reference joins.

- `.cache/outreach/` is git-ignored — add `.cache/` to `.gitignore` if not already covered (it isn't — current `.gitignore` doesn't mention `.cache`).

### `scripts/outreach/scrapers/scrape-luma.cjs`

- **Endpoint**: `https://lu.ma/discover` plus category facets such as `?category=crypto-web3`. Crawl 10 city facets manually for top GPP-target metros plus a global "discover all" run.
- **Parsing**: lu.ma is Next.js — pull the entire HTML, extract the JSON blob from `<script id="__NEXT_DATA__" type="application/json">...</script>` via a single regex, `JSON.parse` it, walk `props.pageProps` for event listings. For each event, extract `host.username`, `host.name`, event city, event count over the last 12 months (count events by the same host).
- **Output mapping**: one row per unique host:
  - `source = 'luma'`
  - `contact_handle = '@' + host.username`
  - `contact_url = 'https://lu.ma/u/' + host.username`
  - `community_name = host.name`
  - `city = normalizeCity(event.city)` (use the host's most recent event city; if hosts run events in multiple cities, write one row per (host, city))
  - `activity_score = number of events in trailing 12 months / 12` (events per month)
- **Rate limit**: 1.5 sec sleep between requests, exponential backoff to 60s on 429.
- **ToS callout**: Inline header comment notes "lu.ma ToS prohibits scraping. This script extracts only public host handles from publicly listed events. Operator must run from a personal IP, not Vercel. If lu.ma serves a CAPTCHA or 403, stop and fall back to the curated seed."

### `scripts/outreach/scrapers/scrape-meetup.cjs`

- **Endpoint**: meetup.com Pro API is paywalled, but their public site uses their own GraphQL at `https://www.meetup.com/gql` for category browsing. As of writing, that endpoint accepts unauthenticated read queries for category=`Cryptocurrency` (`urlname` = `topic/cryptocurrency`).
- **Approach**: POST GraphQL query for top groups in the Cryptocurrency topic, paginated by city. Fall back path: scrape `https://www.meetup.com/topics/cryptocurrency/<countryCode>/<city>/` HTML — group cards have a stable `data-event-label` selector.
- **Parsing**: prefer GraphQL JSON. For HTML fallback, regex-extract `group.urlname`, `group.name`, member count from the embedded `__NEXT_DATA__` blob (meetup is also Next.js).
- **Output mapping**:
  - `source = 'meetup'`
  - `contact_handle = group.urlname`
  - `contact_url = 'https://www.meetup.com/' + group.urlname + '/'`
  - `community_name = group.name`
  - `follower_count = group.memberCount`
  - `activity_score = events_last_90d / 3` (events per month)
- **Rate limit**: 1 req/sec, 60-second cooldown on 429.
- **ToS callout**: same as lu.ma. Note that the GraphQL endpoint may begin requiring auth — if every request returns 401/403, fall back to HTML fragment scrape; if that also fails, skip this source.

### `scripts/outreach/scrapers/seed-curated.cjs`

- **No HTTP at all** — reads the static JSON file `scripts/outreach/curated-communities.json` and upserts every entry.
- **Static JSON shape**:
  ```json
  [
    {
      "city": "Berlin",
      "country": "Germany",
      "communityName": "Web3 Berlin",
      "contactHandle": "@web3berlin",
      "contactUrl": "https://x.com/web3berlin",
      "contactEmail": null,
      "notes": "Bankless DAO Berlin node + ETHBerlin coordinators"
    }
  ]
  ```
- **Initial entries** (~80-120 rows): Bankless DAO city chapters, ETHGlobal hackathon host cities, Devconnect 2025+2026 satellites, major L2 ecosystem chapters (Optimism, Arbitrum, Base, zkSync, Starknet), CityDAO-style projects, Network School cities, popcorn-economy chapters. Snax will pad this list — initial commit can include 30 hand-picked entries and a TODO comment in the JSON header for expansion.
- **Output mapping**: pass-through, `source = 'curated'`, `activity_score = null` (curated entries are trusted on faith — set priority manually).

### `scripts/outreach/scrapers/scrape-x-handles.cjs`

- **Approach**: For each city in `curated-communities.json`'s city list (canonical city seed), generate candidate handles by pattern: `<city>eth`, `web3<city>`, `<city>dao`, `eth<city>`, `<city>web3`. Hit `https://x.com/<handle>` and `https://nitter.net/<handle>` (mirror, often more scrape-friendly) and check whether the profile exists + extract `follower_count` from the embedded JSON.
- **Parsing**: x.com requires JS for most data; instead use `https://api.fxtwitter.com/<handle>` (public unauthenticated metadata endpoint maintained for embed unfurling) which returns JSON: `{ user: { name, screen_name, followers, ... } }`. This is the safest path. If that endpoint is unavailable, skip and log.
- **Output mapping**:
  - `source = 'twitter'`
  - `contact_handle = '@' + handle`
  - `contact_url = 'https://x.com/' + handle`
  - `community_name = user.name`
  - `follower_count = user.followers`
  - `notes = 'auto-flagged for manual triage'` (pattern-match is noisy; collisions like `londonweb3` mapping to actual London communities vs. unrelated accounts need human review)
- **No auto-priority** — leave `priority = NULL` for all twitter rows. Human triage required.
- **Rate limit**: 0.5 req/sec to api.fxtwitter.com. Cache aggressively (7-day TTL) since follower counts don't move much.

## Cross-reference logic

File: `scripts/outreach/cross-reference.cjs`

Inputs:

1. **Gap list** from supreme-43217: read its published Google Sheet as CSV via the public CSV-export URL: `https://docs.google.com/spreadsheets/d/<SHEET_ID>/export?format=csv&gid=<SHEET_TAB_GID>`. Sheet ID + tab GID passed as env vars `GPP_GAP_SHEET_ID` + `GPP_GAP_SHEET_GID`. No Sheets API auth needed for the read path.
2. **outreach_communities** rows via `pg` SELECT.

Algorithm:

1. Load gap CSV → `Map<normalizedCity, { gapWeight, country, ... }>`.
2. Load all `outreach_communities` rows.
3. For each community row, look up its `normalizeCity(city)` in the gap map. Skip if not in gap list (city already covered).
4. Within each gap-city group, dedupe community rows using fuzzy match on `community_name`:
   - Lowercase + strip punctuation.
   - If two rows in the same city have token-set Jaccard similarity > 0.75, keep the one with higher `follower_count` (or higher `activity_score`).
5. Compute score: `score = gapWeight * (1 + log10(1 + (followerCount ?? 0)) + (activityScore ?? 0))`.
6. Bucket the global ranking:
   - Top 50 by score → `priority = 'high'`
   - Next 100 → `priority = 'medium'`
   - Rest → `priority = 'low'` (only if currently `NULL` — preserve any manual `'high'`/`'medium'` someone has set in the table)
7. UPDATE only rows whose computed bucket differs from existing `priority` (and never overwrite manually-set values higher than computed bucket — defensive).
8. **Stdout summary**: ASCII table with columns `[rank, city, source, handle, score, bucket]`, top 50.
9. **Sheet writeback**: append/replace a tab named `Outreach (auto-generated)` in the same gap sheet. Use the Sheets API for the write (requires `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` env var pointing to a service-account key with write access). If the env var is missing, log "skipping sheet writeback; export manually" and dump the same data to `scripts/outreach/output/cross-reference-<timestamp>.csv` (this is the safe default for the first run — Snax can paste it into the sheet).

CLI flags: `--apply` (without it, log all intended UPDATEs but don't run them).

## Files to create

- `supabase/migrations/20260519_create_outreach_communities.sql`
- `backend/prisma/schema.prisma` — append `OutreachCommunity` model (not a new file)
- `scripts/outreach/lib/db.cjs`
- `scripts/outreach/lib/cache.cjs`
- `scripts/outreach/lib/normalize.cjs`
- `scripts/outreach/scrapers/scrape-luma.cjs`
- `scripts/outreach/scrapers/scrape-meetup.cjs`
- `scripts/outreach/scrapers/seed-curated.cjs`
- `scripts/outreach/scrapers/scrape-x-handles.cjs`
- `scripts/outreach/curated-communities.json` (initial 30 entries + comment header)
- `scripts/outreach/cross-reference.cjs`
- `scripts/outreach/README.md` — operator runbook (order: seed-curated → luma → meetup → x → cross-reference; required env vars; ToS warnings)
- `.gitignore` — add `.cache/` and `scripts/outreach/output/`

## Step-by-step implementation

1. **Worktree + branch**: create `stagioni-29104-outreach-scrapers` worktree from `origin/master`.
2. **Migration file**: write `supabase/migrations/20260519_create_outreach_communities.sql` (full SQL above).
3. **Apply migration to prod**: `mcp__supabase-pizzadao__apply_migration` with name `create_outreach_communities`. Verify with `execute_sql` SELECT against `information_schema.columns`.
4. **Prisma model**: append `OutreachCommunity` model to `backend/prisma/schema.prisma`. Run `npm run db:generate --workspace=backend` locally to confirm the schema parses (do not commit `node_modules` changes).
5. **Helpers**: write `scripts/outreach/lib/{db,cache,normalize}.cjs`.
6. **Curated JSON**: write `scripts/outreach/curated-communities.json` with 30 seed entries (Bankless chapters, ETHGlobal hosts, Devconnect satellites).
7. **seed-curated.cjs**: thinnest scraper, validates the upsert pattern end-to-end. Test in `--dry-run` then `--apply` against prod. Confirm 30 rows in `outreach_communities` via `execute_sql`.
8. **scrape-luma.cjs**: implement + run with `--apply` for a single category facet (`crypto-web3`) only. Spot-check 10 rows manually. Then expand to full discover crawl.
9. **scrape-meetup.cjs**: implement GraphQL path first; HTML fallback only if GraphQL returns 401/403.
10. **scrape-x-handles.cjs**: implement against `api.fxtwitter.com`. Treat each lookup as best-effort; never throw on 404 (handle just doesn't exist).
11. **cross-reference.cjs**: implement read-only summary first (no UPDATEs). Run, eyeball output, then enable `--apply`.
12. **README**: operator runbook.
13. **.gitignore**: add `.cache/` and `scripts/outreach/output/`.
14. **Draft PR**: open with title `stagioni-29104: outreach community scrapers + cross-reference`. Body lists the migration, the Prisma model, and notes that the migration has already been applied to prod (so the Prisma change is safe to merge immediately on approval).
15. **Vercel preview**: will build fine — no frontend or backend route changes. Verification is the migration check + a manual scraper dry-run, not the preview URL.

## Verification

- **Migration applied**: `SELECT to_regclass('public.outreach_communities')` returns a non-null oid. `SELECT column_name FROM information_schema.columns WHERE table_name='outreach_communities' ORDER BY ordinal_position` returns the 13 expected columns.
- **No grants leaked**: `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name='outreach_communities'` returns rows only for `postgres`/`service_role` — no `anon` or `authenticated`.
- **Each scraper idempotent**: run `seed-curated.cjs --apply` twice in a row; row count stays at 30, `updated_at` advances, but `priority` and `notes` set manually beforehand are preserved (test: set `priority='high'` on one row, re-run, confirm still `'high'`).
- **Cross-reference sanity**: top-50 list contains plausible city/community pairs (e.g., Lagos, Buenos Aires, Manila if they're in the gap list). No duplicates within a city. No twitter rows in the top 10 (since they're auto-flagged for triage and have no follower-driven priority bump).
- **No 500s after master merge**: `parties` queries continue to succeed on prod for 10 minutes after merge (sanity check that the Prisma client regen didn't break anything).

## Out of scope (handed off)

- **Gap-analysis ranking** — supreme-43217 produces and publishes the source-of-truth gap sheet. This task only consumes its CSV export.
- **Frontend UI / `/underboss/outreach` tab** — marinara-67583.
- **`outreach_attempts` table + message templates** — marinara-67583. Our table only tracks *targets*, not outreach state. Marinara will reference our rows by `outreach_communities.id`.
- **CRM-style follow-up cadences, opens/clicks tracking, multi-channel orchestration** — out of all three tasks. Manual for now.
- **Automating scraper runs on a schedule** — explicitly NO. Scrapers run from a personal laptop on demand. Putting them on Vercel cron would invite IP bans.

### Critical files for implementation

- `supabase/migrations/20260403_sponsor_dashboard.sql` (admin-only table pattern reference)
- `backend/prisma/schema.prisma` (append `OutreachCommunity` model; reference Payout / SponsorUser for style)
- `scripts/backfill-cohost-telegram-from-host.js` (CLI script shape: dry-run default, --apply gate, env-var guards)
- `scripts/backfill-place-ids.js` (more elaborate script pattern: API fetch + CSV output + service-role-key)
- `supabase/migrations/20260518_add_parties_city.sql` (recent migration showing GRANT-and-index conventions to mirror — though here we deliberately omit the GRANT)
