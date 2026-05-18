# sicilian-16268 — Include `city` in UB scope-check selects

## Problem

City-only underbosses (e.g. `sm@ceylabs.io` with `regions=[]`,
`cities=['Galle','Kandy','Colombo','Nuwara Eliya']`) get `403 OUT_OF_SCOPE`
from three bulk endpoints and from every single-event PATCH that goes
through `assertPartyInScope`. Their events show up in listing (which uses a
SQL-side scope filter that does handle cities) but bulk writes fail.

## Root cause

`partyMatchesScope(party, scope)` in
`backend/src/helpers/underbossScope.ts` matches on `party.region` OR
`party.city`. Four call sites in `backend/src/routes/underboss.routes.ts`
fetch the affected parties with an explicit Prisma `select` that includes
`id, region, name, eventType` but omits `city`. So `party.city` arrives as
`undefined`, the city branch never matches, and city-only UBs are reported
out of scope.

## The four call sites

1. `PATCH /events/bulk-host-status` — scope-check select (~line 775)
2. `DELETE /events/bulk-delete` — scope-check select (~line 831)
3. `PATCH /events/bulk-event-tags` — scope-check select (~line 882)
4. `assertPartyInScope` helper — select (~line 981), used by single-event
   PATCH routes

Each currently does:

```ts
select: { id: true, region: true, name: true, eventType: true }
```

## The fix

Add `city: true` to each of those four select clauses. Two-token addition
per site. No DB migration. No schema change. No new helper. No refactor.

Not consolidating the four selects into a shared constant — the existing
duplication is the codebase's pattern and consolidation is unrelated.

The `GET /:region/events/:partyId` handler is already correct (uses
`include` without `select`, returns all scalars including `city`).

## Verification

- `grep -n "partyMatchesScope" backend/src/routes/underboss.routes.ts`
- Confirm each of the four sites now includes `city: true`
- `cd backend && npx tsc --noEmit` passes

## Deploy note

Backend only deploys from `master`. After merge, backend must be
redeployed (`cd backend && vercel --prod --scope pizza-dao`) — preview
branches won't surface this fix because they share the production backend.
