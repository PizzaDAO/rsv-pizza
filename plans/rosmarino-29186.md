# rosmarino-29186: Ampersand-form country aliases for getCountryCode

## Summary

Hotfix for the guanciale-43592 backfill. Snax chose Intl's ampersand spelling for AG/BA/TT, so `parties.country` now contains `Antigua & Barbuda`, `Bosnia & Herzegovina`, `Trinidad & Tobago`. But `backend/src/lib/countryCode.ts` only has the `and`-form aliases, so the leaderboard's `getCountryCode` lookup returns null on those 5 rows → no countryCode → no flag rendered on /leaderboard country tab.

## Decisions

Add three aliases to `backend/src/lib/countryCode.ts`:

```ts
'antigua & barbuda': 'AG',
'bosnia & herzegovina': 'BA',
'trinidad & tobago': 'TT',
```

Keep the existing `and` aliases in place so older data (or pasted-in strings) still classify.

## Backend changes

`backend/src/lib/countryCode.ts` only. No tests required (alias table is pure data; existing tests don't cover individual aliases).

## Frontend changes

None.

## Verification

- [ ] After merge + backend deploy, `/api/leaderboard?nocache=1` returns `countryCode: 'AG'` for the Antigua row, `'BA'` for Bosnia, `'TT'` for Trinidad.
- [ ] /leaderboard country tab renders flags for all three.

## Out of scope

- Renaming back to "and" form.
- Other unrecognized country strings (none remain after guanciale-43592).
