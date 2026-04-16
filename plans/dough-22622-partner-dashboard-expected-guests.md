# dough-22622 — Partner dashboard: expected guests field

**Priority**: Medium

## Goal

On `/partner` dashboard event cards, add a numeric "expected guests" input each partner can fill in for their own expected attendance contribution. Auto-saves on blur. Stored per (partner, event).

## Data model

Use the existing `Sponsor` table (which already represents partner-per-event records). Add a new column:

```prisma
model Sponsor {
  ...
  expectedGuests Int? @map("expected_guests")
  ...
}
```

DB migration:
```sql
ALTER TABLE sponsors ADD COLUMN IF NOT EXISTS expected_guests integer;
```

## Backend

### 1. Read path — extend `fetchSponsorEvents`

Find the route that powers the partner dashboard event list (in `backend/src/routes/sponsor-user.routes.ts` — it's the GET that returns `SponsorDashboardEvent[]`). Each returned event needs a new field `expectedGuests: number | null` — pulled from the Sponsor record matching the calling user's `sponsorUser.email` for that event.

If multiple Sponsor records exist for that party + email (shouldn't but possible), use the first.

### 2. Write path — new endpoint

```
PATCH /api/sponsor/me/events/:partyId/expected-guests
Body: { expectedGuests: number | null }
Auth: requireAuth + verify caller's sponsorUser.tag is in event.eventTags
```

Logic:
- Find party. Verify the calling user has a `sponsorUser` record with `tag in party.eventTags`.
- Upsert: if a Sponsor record already exists for `(partyId, contactEmail = sponsorUser.email)`, update `expectedGuests`. Otherwise insert one with `name = sponsorUser.coHostName || sponsorUser.name || sponsorUser.email`, `contactEmail = sponsorUser.email`, `status = 'yes'`, `notes = 'Auto-created from partner dashboard expected guests entry'`, plus the new `expectedGuests`.
- Return updated row.

Validation: `expectedGuests` must be `null` or a non-negative integer ≤ 10000. Reject otherwise with 400.

## Frontend

### 1. Type

In `frontend/src/types.ts`, add `expectedGuests?: number | null;` to `SponsorDashboardEvent`.

### 2. API helper

In `frontend/src/lib/api.ts`, add:
```ts
export async function updateSponsorExpectedGuests(partyId: string, expectedGuests: number | null) {
  // PATCH /api/sponsor/me/events/:partyId/expected-guests
}
```

### 3. UI — `EventCard` in `PartnerDashboardPage.tsx`

Add a small inline numeric input near the RSVP count (around line 632, `<div className="flex items-center gap-1.5 flex-shrink-0"> ... <Users size={14} ...> ... {event.rsvpCount} ... RSVPs</div>`).

Suggested placement: a second row underneath the date/venue/RSVP row, OR inline next to the RSVP count. A clean version:

```tsx
<div className="flex items-center gap-1.5 flex-shrink-0">
  <Users size={14} className="text-theme-text-muted" />
  <span className="text-lg font-bold text-theme-text">{event.rsvpCount}</span>
  <span className="text-xs text-theme-text-muted">RSVPs</span>
  <span className="text-theme-text-muted mx-1">·</span>
  <input
    type="number"
    min={0}
    max={10000}
    value={localExpected ?? ''}
    onChange={(e) => setLocalExpected(e.target.value === '' ? null : parseInt(e.target.value, 10))}
    onBlur={() => saveExpectedGuests()}
    placeholder="—"
    className="w-14 bg-theme-surface border border-theme-stroke rounded text-sm text-theme-text px-1.5 py-0.5 text-right focus:outline-none focus:border-theme-stroke-hover"
    title="Your expected guests"
  />
  <span className="text-xs text-theme-text-muted">expected</span>
</div>
```

Local state pattern (matches existing optimistic update pattern in this codebase):
```ts
const [localExpected, setLocalExpected] = useState<number | null>(event.expectedGuests ?? null);

async function saveExpectedGuests() {
  if (localExpected === (event.expectedGuests ?? null)) return; // no change
  try {
    await updateSponsorExpectedGuests(event.id, localExpected);
    // Don't refetch — optimistic update is enough
  } catch (err) {
    setLocalExpected(event.expectedGuests ?? null); // revert on failure
    console.error('Failed to save expected guests:', err);
  }
}
```

## Files to create/modify

1. **DB migration** via `mcp__supabase-pizzadao__apply_migration` — add `expected_guests` column
2. `backend/prisma/schema.prisma` — add `expectedGuests Int? @map("expected_guests")` to Sponsor model
3. `backend/src/routes/sponsor-user.routes.ts` — extend GET response, add PATCH endpoint
4. `frontend/src/types.ts` — add `expectedGuests?: number | null` to `SponsorDashboardEvent`
5. `frontend/src/lib/api.ts` — add `updateSponsorExpectedGuests` helper
6. `frontend/src/pages/PartnerDashboardPage.tsx` — add input to `EventCard`

## Order of operations (CRITICAL)

Per CLAUDE.md: "Preview deploys share production backend + DB. New DB columns must be applied to production BEFORE they'll work on preview branches."

1. Apply DB migration to production Supabase first (column add — safe, additive only)
2. Deploy backend to production (since preview frontend hits prod backend) — happens automatically when this branch merges to master
3. Frontend Vercel preview will then work end-to-end

For the PR: the agent should apply the DB migration immediately (additive, low risk). The backend changes won't take effect on the preview until merged to master. **The Vercel preview will only show the UI element — the read/write won't work until merge.** Note this in the PR description so Snax doesn't think it's broken.

## Verification

After merge to master + backend deploy:

1. Open `/partner` dashboard logged in as a partner (e.g., ownthedoge → smoke@ownthedoge.com)
2. Each event card shows the expected-guests input (empty if never set)
3. Type a number → click outside → input persists
4. Refresh page → number is still there
5. Multiple partners on the same event each have their own number
6. Negative numbers / non-integers / values >10000 are rejected by backend
7. Logged-in admin viewing /underboss → can query DB to see the values (admin UI for these is a follow-up)

## Notes

- Don't modify the Sponsor `status` of existing rows. Only set `status='yes'` when CREATING a new Sponsor row from the partner dashboard (auto-created).
- Don't surface this in the existing partner-intake flow — that's a different feature.
- No CLAUDE.md "7-places" gotchas here since this is the Sponsor table, not the parties table — but verify the backend handler uses Prisma not Supabase client.
