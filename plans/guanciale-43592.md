# guanciale-43592: Backfill parties.country to canonical American English

## Summary

The new public `/leaderboard` (stromboli-71593) groups countries by raw `parties.country` string and is showing duplicates whenever a host's Google Places chooser was in their own locale (`España`/`Spain`, `Deutschland`/`Germany`, `日本`/`Japan`, etc.). Per Snax: backfill the DB — rewrite `parties.country` to canonical American English in-place. Affects /leaderboard, EventPage, /map, /partner, /gpp/events, and every other consumer instantly. Defense-in-depth: also canonicalize on the POST/PATCH `/api/parties` path so new events created after the backfill stay canonical.

## Decisions (with rationale)

### Canonical-name source — Intl.DisplayNames + override map

Use `new Intl.DisplayNames(['en'], { type: 'region' }).of(isoCode)` as the base, with an explicit override map for codes where Intl's output is non-American, has formatting quirks, or disagrees with the existing `backend/src/lib/countryCode.ts` table.

Why Intl over a hardcoded reverse map: zero ongoing maintenance for the common case (~95% of countries); Intl already returns "Spain", "Germany", "Mexico", "Japan", "South Korea", "Czechia", "Vietnam", "Timor-Leste", "U.S. Virgin Islands" — all matching American usage.

Verified overrides needed (Node 22 output checked):
- `HK` → Intl says **"Hong Kong SAR China"**, override to `"Hong Kong"`.
- `MO` → Intl says **"Macao SAR China"**, override to `"Macao"`.
- `MM` → Intl says **"Myanmar (Burma)"**, override to `"Myanmar"`.
- `CD` → Intl says **"Congo - Kinshasa"**, override to `"DR Congo"`.
- `CG` → Intl says **"Congo - Brazzaville"**, override to `"Congo"`.
- `CI` → Intl says **"Côte d'Ivoire"** (curly apostrophe U+2019); normalize to straight apostrophe.
- `ST` → Intl says **"São Tomé & Príncipe"**, override to `"São Tomé and Príncipe"`.
- `PS` → Intl says **"Palestinian Territories"**, override to `"Palestine"` (Snax preference).

The override map lives in the new canonicalizer module, not in `countryCode.ts`, so the existing forward (name→code) helper is unchanged.

### Special cases for Snax

| ISO | Intl output | Existing table accepts | Proposed canonical |
|---|---|---|---|
| CI | Côte d'Ivoire | Côte d'Ivoire, Ivory Coast | "Côte d'Ivoire" |
| CZ | Czechia | Czechia, Czech Republic | "Czechia" |
| MM | Myanmar (Burma) | Myanmar | "Myanmar" |
| CD | Congo - Kinshasa | DR Congo, Democratic Republic of the Congo | "DR Congo" |
| PS | Palestinian Territories | Palestine, Palestinian Territories | "Palestine" |
| MO | Macao SAR China | Macau | "Macao" |
| US | United States | United States, USA, United States of America | "United States" |

Snax can edit the override map in the canonicalizer file before running the script.

### Defense-in-depth on the create path — YES

`backend/src/routes/party.routes.ts` POST and PATCH both write `country: country || null` straight from the request body. Hook canonicalization in **at the backend** (single chokepoint, no frontend change needed — `LocationAutocomplete` continues to send Google Places' raw `long_name`). Without this, every new event from a non-English-locale host re-introduces dupes within days of the backfill.

Pattern: replace `country || null` with `canonicalizeCountryName(country) ?? country ?? null` in both endpoints. The fallback to the raw value (not null) preserves any unrecognized string — same "log + preserve" guarantee as the backfill script.

Frontend `LocationAutocomplete` is **not** changed in this task — the backend is the canonicalization seam.

### Leaderboard code change — NO

Once `parties.country` is canonical, the existing case-insensitive group-by in `aggregateCountries()` (publicLeaderboard.routes.ts) is sufficient. Adding a redundant group-by-ISO inside the route would obscure rather than help: callers like EventPage display `party.country` directly, and any drift between "what /leaderboard groups by" and "what EventPage shows" would re-introduce confusion. The backfill + create-hook keeps the DB column as the single source of truth.

### Migration approach — one-shot script, not Prisma migration

`scripts/backfill-canonical-country-names.cjs`, modeled on `scripts/fix-kit-countries.js` and `scripts/backfill-place-ids.js`:
- Dry-run by default (no `--apply` flag = print + exit).
- Loads `backend/.env` via `DOTENV_PATH || path.resolve(__dirname, '..', 'backend', '.env')` (matches `fix-kit-countries.js`, works in worktrees per memory).
- Uses `pg` client + `DATABASE_URL`.
- Loops one UPDATE per changed row, logging each (id, original → canonical).

Why NOT a Prisma migration: per the task constraints + `CLAUDE.md`, Prisma migrations auto-run on backend deploy — we want this to be a **deliberate, observable, two-phase** operation that Snax watches.

## Backend changes

### New library — `backend/src/lib/canonicalCountryName.ts`

```ts
import { getCountryCode } from './countryCode.js';

const ENGLISH_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

const OVERRIDES: Record<string, string> = {
  HK: 'Hong Kong',
  MO: 'Macao',
  MM: 'Myanmar',
  CD: 'DR Congo',
  CG: 'Congo',
  PS: 'Palestine',
  ST: 'São Tomé and Príncipe',
};

export function canonicalizeCountryName(input: string | null | undefined): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const code = getCountryCode(trimmed);
  if (!code) return null;

  if (code in OVERRIDES) return OVERRIDES[code];

  const name = ENGLISH_NAMES.of(code);
  if (!name) return null;
  // Intl emits U+2019 in "Côte d'Ivoire"; normalize to ASCII.
  return name.replace(/’/g, "'");
}
```

Tests in `backend/src/lib/canonicalCountryName.test.ts`:
- Spain/España/ES all return `"Spain"`.
- Deutschland/Germany/DE all return `"Germany"`.
- México/Mexico/MX → `"Mexico"`.
- 日本/Japan/JP → `"Japan"`.
- HK input → "Hong Kong" (not "Hong Kong SAR China").
- CD input → "DR Congo" (not "Congo - Kinshasa").
- "Côte d'Ivoire" with curly apostrophe → with straight apostrophe.
- null/empty → null.
- "Atlantis" → null.

### Backfill script — `scripts/backfill-canonical-country-names.cjs`

- Dry-run by default; `--apply` to write.
- Uses `pg` + `DATABASE_URL` from `backend/.env`.
- Inline copy of the override map + `getCountryCode` (CJS, no TS import; accept duplication for a one-off).
- `SELECT id, country FROM parties WHERE country IS NOT NULL`.
- For each row: compute canonical, classify as no-op / change / unrecognized.
- Print histogram of `(before → after)` grouped by count desc; print unrecognized list with row ids.
- If `--apply`: loop `UPDATE parties SET country = $1 WHERE id = $2 AND country = $3` — `WHERE country = $before` guards against races.

### Create-path hook — `backend/src/routes/party.routes.ts`

Two changes, same file:

POST `/` (around line 318):
```diff
- country: country || null,
+ country: canonicalizeCountryName(country) ?? country ?? null,
```

PATCH `/:id` (around line 724):
```diff
- ...(country !== undefined && { country: country || null }),
+ ...(country !== undefined && {
+   country: canonicalizeCountryName(country) ?? country ?? null,
+ }),
```

Import at top:
```ts
import { canonicalizeCountryName } from '../lib/canonicalCountryName.js';
```

The `?? country` fallback preserves any unrecognized string verbatim.

## Frontend changes

None.

## Run plan

1. Branch + worktree: `guanciale-43592-country-backfill`, off `master`.
2. Build the canonicalizer + tests. Run `npm test -- canonicalCountryName` in `backend/`.
3. Write the script: `scripts/backfill-canonical-country-names.cjs`.
4. Dry-run from the worktree. Snax reviews the histogram + unrecognized list.
5. Snax edits the override map if any special cases need a different choice.
6. Apply: `node scripts/backfill-canonical-country-names.cjs --apply`.
7. Verify with `SELECT DISTINCT country FROM parties` — only canonical English.
8. Refresh `/leaderboard?nocache=1` — dupes gone.
9. Ship create-hook PR so new events stay canonical.

## Verification checklist

- [ ] Dry-run output shows every change as `<count>  <before> → <after>` lines, sorted by count desc.
- [ ] Dry-run output lists every unrecognized country string with its row id.
- [ ] `/leaderboard?nocache=1` shows no duplicate countries.
- [ ] A previously-Spanish-locale event's EventPage renders "Spain" not "España".
- [ ] `/map` country count drops to # of unique ISO codes.
- [ ] Special-case rows render per Snax's confirmed choices.
- [ ] `country IS NULL` rows are still NULL (verify count before/after — should match).
- [ ] Unrecognized country strings are preserved + were logged.
- [ ] After the create-hook ships, a freshly created event with `country: "Deutschland"` lands in DB as `"Germany"`.
- [ ] No new Prisma migration (verify `git diff backend/prisma` empty).
- [ ] No frontend changes (`git diff frontend/` empty).

## Resolved decisions (Snax 2026-06-05)

- CI → **Côte d'Ivoire** (straight apostrophe).
- CD → **DR Congo**.
- PS → **Palestine** (override Intl default "Palestinian Territories").
- MO → **Macao** (override existing-table "Macau"; Intl/ISO spelling).

## Out of scope

- Rewriting locale autodetect in `LocationAutocomplete` to force English Places results.
- Translating UI to other languages.
- Backfilling `parties.city` (only `country` in scope).
- Backfilling `kits.country` (already done ad-hoc).
- Backfilling `users.country`.
- Adding `country_code` column to `parties`.
