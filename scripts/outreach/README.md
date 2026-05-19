# scripts/outreach

Outreach / community-recruitment tooling for the Global Pizza Party (GPP) host
network. One-shot scripts that produce CSV/Sheet artifacts; nothing here runs
on a schedule or ships with the deployed app.

## `coverage-gap-2026.cjs`

Plan: [`plans/supreme-43217-blockchain-city-gap-analysis.md`](../../plans/supreme-43217-blockchain-city-gap-analysis.md)

Ranks world cities by `log10(population) * web3_score * (1 - has_gpp_party_for_2026)`
and writes the top 200 to a Google Sheet. Cities already covered by a 2026 GPP
event are zeroed out so they never appear in the top list (but are still
logged on a separate tab for QA).

### Run it

```bash
# Dry-run — print the top 20 to stdout, do NOT create a sheet.
node scripts/outreach/coverage-gap-2026.cjs --dry-run

# Live run — creates a new Google Sheet, prints the URL.
node scripts/outreach/coverage-gap-2026.cjs

# Restrict "covered" to underboss_status='approved'.
node scripts/outreach/coverage-gap-2026.cjs --coverage-mode=approved-only

# Overwrite an existing sheet instead of creating a fresh one.
node scripts/outreach/coverage-gap-2026.cjs --sheet-id=<google-sheet-id>
```

### Setup

1. `cp scripts/outreach/.env.example scripts/outreach/.env`, then fill in
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` from your
   `~/.claude/CLAUDE.md` gdrive section.
2. Make sure `backend/.env` has `DATABASE_URL` (production Postgres).
3. Make sure root deps are installed (`npm install` at the repo root) — pulls
   in `googleapis`, `pg`, `dotenv`.

### CLI flags

| Flag                          | Default                              | Description                                                                  |
| ----------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| `--dry-run`                   | off                                  | Print top 20 to stdout. NO sheet is created. NO Google OAuth needed.         |
| `--coverage-mode=<mode>`      | `any`                                | `any` (counts all 2026 GPP parties as coverage) or `approved-only`.          |
| `--limit=<N>`                 | `200`                                | Top-N rows in tab 1.                                                         |
| `--sheet-id=<id>`             | _create new_                         | Overwrite an existing Google Sheet.                                          |
| `--calendar-link=<url>`       | `https://cal.com/pizzadao/gpp-host`  | Host-onboarding link emitted in tab 1 (hard-coded; confirm before relying).  |

### Sheet structure

The script writes 4 tabs:

1. **`Top Gap Cities`** — top-N ranked candidates with population, web3 score,
   weighted score, and the calendar link Snax can paste into outreach DMs.
2. **`Covered Cities`** — every city already covered by a 2026 GPP party (for
   QA — verify the match was correct).
3. **`Unmatched GPP Events`** — parties whose city couldn't be resolved
   against the GeoNames dataset. Add entries to
   `scripts/outreach/data/city-aliases.json` to fix these.
4. **`Run Metadata`** — counters, the coverage-mode flag, GeoNames
   attribution, and pointer to the v2 web3-score-replacement task.

### Data files

| File                                 | Source                                                                                                  | Notes                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `data/cities15000.txt`               | [GeoNames cities15000](https://download.geonames.org/export/dump/cities15000.zip) — CC-BY 4.0           | Bundled (~8 MB extracted). Re-download via the link if rebuilding.                 |
| `data/iso2-to-country.json`          | Derived from [GeoNames countryInfo.txt](https://download.geonames.org/export/dump/countryInfo.txt)      | One-time generated. Same CC-BY 4.0 attribution.                                    |
| `data/web3-cities-seed.json`         | Hand-curated by Snax                                                                                    | 30 entries v1. Task `stagioni-29104` will replace with scraper-derived counts.     |
| `data/city-aliases.json`             | Hand-edited as warnings appear                                                                          | Format: `"<normalized raw>": "GeoNames City|US"`                                   |

### Attribution requirement

The bundled population data is from GeoNames and licensed under
[CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/). The "Run Metadata"
tab carries the attribution string; preserve it if you copy the sheet
elsewhere.

### Web3-score replacement hook (v2)

Search `coverage-gap-2026.cjs` for `buildWeb3Scorer`. Task `stagioni-29104`
(scrapers) will replace the in-memory seed lookup with a Postgres query over
`outreach_communities`. Keep the function signature
`getWeb3Score(geoRow) -> number` stable so the upgrade is a one-file change.

### Verification

- **Dry-run prints 20 cities.** Sanity-check: NYC, SF, Berlin should NOT
  appear (they're covered every year).
- **Unmatched count** in tab 3 should be `<10`. Higher = add aliases.
- **Weighted score** in tab 1 is monotonically decreasing.

## Other tools

(none yet — `stagioni-29104` and `marinara-67583` will add more)
