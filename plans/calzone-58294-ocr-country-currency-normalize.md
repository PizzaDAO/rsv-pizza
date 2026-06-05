# calzone-58294 — OCR currency prior resolves full-name countries (Togo→XOF)

## Problem
`backend/src/services/ocr.service.ts` builds the receipt-OCR currency prior in
`buildSystemPrompt(partyCountry)` by slicing the first 2 chars of the country
and upper-casing:

```js
const code = partyCountry.trim().toUpperCase().slice(0, 2);
const primary = code ? COUNTRY_TO_PRIMARY_CURRENCY[code] : undefined;
```

`COUNTRY_TO_PRIMARY_CURRENCY` is keyed by ISO-3166-1 alpha-2 codes
(`TG: 'XOF'`). But `parties.country` stores the **full English name** ("Togo"),
and the callers (`payout.routes.ts`, `admin-payout.routes.ts`) pass
`party.country` straight through. `"Togo".slice(0,2)` = `"TO"` (Tonga, not in
the map) so the prior never fired. Same breakage for "Mexico"→"ME",
"United States"→"UN", etc. — i.e. essentially every full-name country.

## Fix
Reuse the existing canonical normalizer `getCountryCode()` from
`backend/src/lib/countryCode.ts` (free-text name → ISO-2, already contains
`'togo': 'TG'` + the CFA countries) instead of slicing:

```js
const raw = typeof partyCountry === 'string' ? partyCountry.trim() : '';
const code =
  getCountryCode(raw) ??
  (/^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : '');
const primary = code ? COUNTRY_TO_PRIMARY_CURRENCY[code] : undefined;
```

The regex fallback keeps back-compat for any legacy caller passing a bare
2-letter ISO-2 code. The rest of `buildSystemPrompt` (prompt interpolation of
`code`/`primary`) is unchanged. Updated the stale "(ISO-2)" JSDoc.

Scope: this one file only. No call sites, `fx.service.ts`, or frontend touched.

## Verification
- `cd backend && npx tsc --noEmit` — clean (only pre-existing unrelated
  `auth.test.ts` jsonwebtoken-typings error remains, present on origin/master).
- Added `backend/src/services/ocr.service.test.ts` (vitest, mirrors
  `countryCode.test.ts`): asserts the prompt for "Togo" contains "XOF", "Mexico"
  → "MXN", "United States" → "USD", bare "TG"/"mx" still resolve, and unknown/
  null/empty omit the prior. 4 tests pass.

## Notes
Backend-only fix — won't show on the frontend Vercel preview. Goes live when
merged to master (backend auto-deploys from master push).
