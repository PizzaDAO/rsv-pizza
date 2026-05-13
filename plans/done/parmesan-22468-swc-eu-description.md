# parmesan-22468: Fix SWC EU sponsor description showing i18n placeholder

**Priority:** P2
**Status:** Doing

## Problem
On EventPage, the Stand With Crypto EU sponsor's description renders as the literal i18n key string `sponsorDescription.swcEu` instead of the translated description. Visible in English mode.

## Root cause
`frontend/src/pages/EventPage.tsx:1155`:
```ts
const desc = (sponsorKey && i18n.language !== 'en') ? t(`sponsorDescription.${sponsorKey}`) : sponsor.brandDescription;
```
In English mode the code uses `sponsor.brandDescription` from the DB. The SWC EU sponsor row's `brandDescription` column was populated with the literal i18n key string (`sponsorDescription.swcEu`) instead of the actual English text, so the page renders the placeholder.

The English text already exists in `frontend/src/i18n/locales/en/event.json:48` (alongside all 5 other locales).

## Fix (hybrid #1 + #4)

### Code change
`frontend/src/pages/EventPage.tsx:1155` — drop the `&& i18n.language !== 'en'` guard so any sponsor whose name appears in the recognized-sponsor lookup always renders from the locale file, regardless of language:

```ts
const desc = sponsorKey ? t(`sponsorDescription.${sponsorKey}`) : sponsor.brandDescription;
```

This makes the 5 globally-recognized sponsors (ENS, Brave, World Pizza Champions, Own The Doge, Stand With Crypto EU) always use the canonical locale text. Custom/unknown sponsors continue to render their DB `brandDescription` as before.

### Data cleanup
Update every Stand With Crypto EU sponsor row whose `brandDescription` currently equals `sponsorDescription.swcEu` (or otherwise contains the placeholder) to the canonical English text from `en/event.json` — or to `NULL`/empty since the code change makes the DB value unused for recognized sponsors. Setting it to the real English text is safer in case the code path ever changes.

SQL (run after merge via Supabase MCP):
```sql
UPDATE sponsors
SET "brandDescription" = 'is a nonprofit advocating for clear, common-sense crypto regulations. If you believe in the power of blockchain and want the EU and your government to foster a positive business and policy environment for crypto assets and blockchain technology, make your voice heard.'
WHERE name = 'Stand With Crypto EU'
  AND "brandDescription" = 'sponsorDescription.swcEu';
```

(Verify the exact table/column name — could be `sponsors` or `party_sponsors`, and casing may differ. Check the Prisma schema before running.)

## Files to modify
- `frontend/src/pages/EventPage.tsx` — line 1155 only

## Verification
1. Vercel preview loads.
2. Visit a published event that has Stand With Crypto EU as a sponsor (English UI). The description should be the full nonprofit description, not the placeholder.
3. Switch language to e.g. Spanish — description should be the Spanish translation (regression check, was already working).
4. Verify other recognized sponsors (ENS, Brave, WPC, Own The Doge) still render correctly in English (they will now also pull from the locale file instead of the DB).

## Out of scope
- Adding support for additional named sponsors to the lookup map.
- Migrating the sponsor name → key mapping out of the JSX into a constant (could be a follow-up cleanup).
