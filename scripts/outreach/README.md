# Outreach Community Scrapers (stagioni-29104)

Data-collection layer feeding the `/underboss/outreach` admin UI
(marinara-67583). Populates the `outreach_communities` admin-only staging
table, then cross-references against supreme-43217's gap-analysis Google
Sheet to bucket entries into priority (high / medium / low).

## TOS / Legal posture

lu.ma, meetup.com, and x.com Terms of Service all prohibit automated
scraping. The scope of these scripts is limited to **public organizer /
community handles only** — no member lists, no DMs, no auth-walled data.

**Operator rules:**

- Run scrapers from your **personal residential IP** — NEVER from Vercel,
  Render, or any other cloud / CI environment.
- Rate limits are conservative on purpose. Do not lower them.
- If a scraper returns 403 / CAPTCHA / login-wall, **stop the scraper and
  fall back to the curated seed list**. Do not implement evasion.
- Treat every `source='twitter'` row as **manual-triage**. Pattern-match
  handle generation is noisy by design.

## Files

```
scripts/outreach/
  curated-communities.json          # 30 hand-picked seed entries (start here)
  README.md                         # this file
  cross-reference.cjs               # join against supreme-43217 gap sheet
  lib/
    db.cjs                          # pg upsertCommunity() (preserves priority/notes)
    cache.cjs                       # disk cache for HTTP (.cache/outreach/, gitignored)
    normalize.cjs                   # normalizeCity, normalizeName, jaccard
  scrapers/
    seed-curated.cjs                # idempotent JSON -> DB (NO http)
    scrape-luma.cjs                 # lu.ma/discover, __NEXT_DATA__ extraction
    scrape-meetup.cjs               # meetup.com GraphQL with HTML fallback
    scrape-x-handles.cjs            # api.fxtwitter.com handle pattern lookup
```

## Required env vars

Source these from `backend/.env` or set inline:

```
DATABASE_URL=postgresql://...           # required for all scripts (write target)
GPP_GAP_SHEET_ID=...                    # cross-reference.cjs only
GPP_GAP_SHEET_GID=0                     # cross-reference.cjs only (default 0)
```

`scrape-x-handles.cjs` uses the **public** api.fxtwitter.com metadata endpoint
— no auth required.

## Run order

```bash
# 1. Seed the canonical list first (no HTTP, populates the city list scrape-x uses)
node scripts/outreach/scrapers/seed-curated.cjs --apply

# 2. lu.ma — extracts public host handles from discover listings
node scripts/outreach/scrapers/scrape-luma.cjs              # dry-run
node scripts/outreach/scrapers/scrape-luma.cjs --apply

# 3. meetup.com — extracts public Cryptocurrency-topic groups
node scripts/outreach/scrapers/scrape-meetup.cjs            # dry-run
node scripts/outreach/scrapers/scrape-meetup.cjs --apply

# 4. X handle pattern match (manual-triage output — noisy)
node scripts/outreach/scrapers/scrape-x-handles.cjs         # dry-run
node scripts/outreach/scrapers/scrape-x-handles.cjs --apply

# 5. Cross-reference against supreme-43217's gap sheet (sets priority buckets)
#    Skip this step until supreme-43217's sheet is published.
export GPP_GAP_SHEET_ID=...
export GPP_GAP_SHEET_GID=...
node scripts/outreach/cross-reference.cjs                   # dry-run
node scripts/outreach/cross-reference.cjs --apply
```

All scripts are dry-run by default. Pass `--apply` to write.
Pass `--no-cache` to bypass the on-disk cache.

## Idempotency / manual-edit guarantees

- Upsert key is `(source, contact_url)`. Re-running a scraper updates
  metadata (name, city, follower_count, activity_score) but **never**
  overwrites `priority` or `notes`. You can manually set
  `priority='high'` or write triage notes against any row and re-run
  scrapers indefinitely without losing them.
- `cross-reference.cjs --apply` only writes `priority` where it is
  currently `NULL`. Manual `priority='high'` values are preserved.

## Where to extend

- **Curated list**: `curated-communities.json` — add entries freely. Format
  is enforced at runtime; `seed-curated.cjs` validates each row.
- **lu.ma category facets**: edit the `DISCOVER_URLS` array in
  `scrape-luma.cjs`. Default is `?category=crypto-web3`.
- **Meetup seed cities**: edit the `SEED_CITIES` array in `scrape-meetup.cjs`.
- **X handle patterns**: edit `candidates(city)` in `scrape-x-handles.cjs`.

## DB / RLS

`outreach_communities` is admin-only. Access pattern mirrors `sponsor_users`:

- RLS enabled, NO permissive policies.
- NO grants to `anon` / `authenticated` (explicitly revoked in the migration).
- All writes from these scripts go via `pg` + `DATABASE_URL`. The backend
  Express app (marinara-67583) reads via `service_role` key, which bypasses
  RLS.
