# quattro-formaggi-88980 — Partner dashboard: sort Newest/Oldest by created date

## Problem
On `/partner` (PartnerDashboardPage), the sort dropdown's "Newest" and "Oldest" options currently sort by `event.date` (the scheduled event date), which puts future-dated events at the top regardless of when they were created. Snax wants both options to use the event's **created date** (`Party.createdAt`) instead.

## Scope
Replace event-date sorting with created-date sorting for both `date-desc` ("Newest") and `date-asc` ("Oldest") values. The dropdown labels (`dashboard.sortNewest` / `dashboard.sortOldest`) stay the same — only the semantics change.

## Files to change

### 1. Backend — expose `createdAt` on the sponsor events endpoint
`backend/src/routes/sponsor-user.routes.ts`

- In the response mapper around line 756–810 (the `return { id: event.id, name: event.name, ... }` shape), add:
  ```ts
  createdAt: event.createdAt,
  ```
  next to the existing `date: event.date,` line.
- Prisma includes `createdAt` by default unless an explicit `select` is in use. Check the query (around line 575 — `orderBy: { date: 'asc' }`) and confirm whether it uses `select`. If it does, add `createdAt: true`. If it uses `include` / no select, `event.createdAt` is already populated.

### 2. Frontend type — add `createdAt` to `SponsorDashboardEvent`
`frontend/src/types.ts` around line 1205

Add after `date: string | null;`:
```ts
createdAt: string;
```
(Non-nullable — every Party row has a `createdAt` from the Prisma `@default(now())`.)

### 3. Frontend sort — switch comparator to `createdAt`
`frontend/src/pages/PartnerDashboardPage.tsx` lines 407–425

Change the `date-asc` and `date-desc` cases to use `createdAt` instead of `date`:

```ts
case 'date-asc':
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
case 'rsvps':
  return (b.rsvpCount || 0) - (a.rsvpCount || 0);
case 'clicks':
  return (b.clickStats?.totalClicks || 0) - (a.clickStats?.totalClicks || 0);
case 'name':
  return (a.name || '').localeCompare(b.name || '');
case 'date-desc':
default:
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
```

Drop the `if (!a.date) return 1` / `if (!b.date) return -1` null-guards — `createdAt` is always set.

## Verification
- Open `/partner` on the preview as an admin or sponsor user.
- Default sort ("Newest") should put the most-recently-created events at the top, regardless of event date.
- Switch to "Oldest" — earliest-created events should come first.
- Other sort options ("Most RSVPs", "Most Clicks", "Name A-Z") should be unaffected.

## Out of scope
- Renaming the dropdown labels.
- Adding a new "Recently Added" option (we explicitly chose to *replace* the date semantics).
- Any change to underboss or other event lists — only `/partner`.

## Notes / gotchas
- This is a frontend-data-shape change, so the backend must ship to master first before the preview will actually return `createdAt`. Standard preview-vs-prod-backend caveat applies.
- The default `sortBy` state (`useState<string>('date-desc')`) does not need to change.
