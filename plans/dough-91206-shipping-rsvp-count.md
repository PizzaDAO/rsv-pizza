# dough-91206 — Shipping dashboard: per-kit RSVP count + inline no-kit events

**Priority**: P2
**Branch**: dough-91206-shipping-rsvp-count

## Summary

Two related additions to `/shipping`:

1. New **sortable** `RSVPs` column in `KitTable` showing the count of non-declined guests for each kit's event.
2. Inline placeholder rows in `KitTable` for GPP-approved events that have NOT submitted a kit request, scoped to the coordinator's regions.
3. New **"No request" stat card** on the dashboard counting placeholder events in the current region scope.
4. New **"No request" pseudo-status** in the status filter dropdown that swaps the table to placeholder-only.

No DB schema changes. Pure read-side feature: extends `GET /api/shipping/kits`, `GET /api/shipping/stats`, and the CSV export with new fields, then updates the `ShippingKit` type, `KitStats`, `KitFilters`, `KitTable`, and `KitRow` on the frontend.

## Decisions locked in (from Snax 2026-05-18)

- **Non-declined RSVP filter**: `Guest.status NOT IN ('DECLINED', 'INVITED')` — counts `CONFIRMED + PENDING + WAITLISTED`.
- **Add "No request" stat card** to the dashboard (open question #2 → YES).
- **Add `no_request` pseudo-status** to the status filter dropdown (open question #3 → YES).
- **RSVPs column is sortable** in phase 1.
- Placeholder row ID convention: `placeholder:<partyId>` (open question #4 → YES).
- Placeholder sort behavior: when sorting by RSVPs, placeholders sort by their RSVP count alongside real kits. For other columns (`requestedAt`, `status`), placeholders sort to the bottom (acceptable, open question #5 → YES).

## Behavior

### Per-kit RSVP count
- New `rsvpCount: number` field on each kit returned by `GET /api/shipping/kits`.
- Column rendered between **Event** and **Region** (visually compact: e.g. `12` in muted text, optionally with a small users icon).
- **Sortable** — wrap in `SortHeader` with `field="rsvpCount"`. Sort happens client-side in `sortedKits` memo (no backend orderBy change needed).

### Inline "no kit request" placeholder rows
- Same endpoint (`GET /api/shipping/kits`) returns BOTH real kits and placeholder rows for eligible parties with no `party_kits` row.
- Eligibility for a placeholder row:
  - `parties.region IS NOT NULL`
  - `parties.underbossStatus = 'approved'`
  - No related `PartyKit` row (Prisma: `partyKit: { is: null }` — `PartyKit.partyId` is `@unique`, so the relation field on `Party` is the singular scalar `partyKit`, not `kits`. **This contradicts the spec hint `kits: { none: {} }` — use the actual relation name from the schema.**)
- Placeholder rows are region-scoped exactly like real kits (admin sees all; coordinator sees only their `regions[]`).
- In the Status column we render a distinct "No kit request" badge (gray/orange) instead of a status `<select>`.
- Tier dropdown, Tracking inputs, the row checkbox, and the bulk-action select are SUPPRESSED for placeholder rows (nothing to update server-side).
- Recipient / address / country fields are empty (rendered as "—").
- `rsvpCount` is still populated for placeholder rows (the event still has guests).
- Search filter (`search` query param) applies to placeholders too: party name and host name/email. Tier and Country filters never match placeholders (they have no kit tier / shipping country). Status filter behavior:
  - `status=""` (empty / "All"): placeholders included alongside real kits.
  - `status="no_request"` (new): table shows placeholders ONLY (no real kits).
  - `status="pending"` / `approved` / `shipped` / `delivered` / `declined`: placeholders excluded.

## Open questions

All resolved — see "Decisions locked in" above.

## Backend changes

### Files
- `backend/src/routes/shipping.routes.ts` — extend `GET /kits` (~line 374), `GET /kits/export` (~line 153), and `GET /stats` (~line 111).
- No Prisma schema change. No migration. No GRANT. (Confirm: feature is read-only on existing tables — `Party`, `Guest`, `PartyKit`.)

### `GET /api/shipping/kits` — merged query pseudocode

```ts
// Treat status=='no_request' as a special placeholders-only mode.
const placeholdersOnly = status === 'no_request';
const realKitsStatusFilter = placeholdersOnly ? null : status;

// 1. Real kits (existing query, unchanged) — now include guest count.
//    Skip entirely when placeholdersOnly=true.
let kits: any[] = [];
if (!placeholdersOnly) {
  const realWhere = { ...where };
  if (realKitsStatusFilter && typeof realKitsStatusFilter === 'string') {
    realWhere.status = realKitsStatusFilter;
  }
  kits = await prisma.partyKit.findMany({
    where: realWhere,
    include: {
      party: { select: { /* existing fields */
        _count: {
          select: {
            guests: {
              where: { status: { notIn: ['DECLINED', 'INVITED'] } }
            }
          }
        }
      } },
    },
    orderBy,
  });
}

// 2. Placeholder parties — include when status is empty OR status === 'no_request'.
//    Tier/Country filters never match placeholders, so skip when those are set.
const shouldIncludePlaceholders =
  (placeholdersOnly || !status) && !tier && !country;

let placeholderParties: any[] = [];
if (shouldIncludePlaceholders) {
  const partyRegionFilter = regions.includes('__admin__')
    ? {}
    : { region: { in: regions } };
  const explicitRegion = region && typeof region === 'string' ? { region } : {};

  placeholderParties = await prisma.party.findMany({
    where: {
      ...partyRegionFilter,
      ...explicitRegion,
      region: { not: null },
      underbossStatus: 'approved',
      partyKit: { is: null }, // verify relation name vs schema.prisma
    },
    select: {
      id: true, name: true, region: true, date: true,
      address: true, venueName: true, underbossStatus: true,
      user: { select: { name: true, email: true } },
      _count: {
        select: {
          guests: {
            where: { status: { notIn: ['DECLINED', 'INVITED'] } }
          }
        }
      }
    },
    orderBy: { date: 'desc' },
  });
}

// 3. Apply search filter to BOTH lists in memory.
//    For placeholders, search matches party.name, user.name, user.email.

// 4. Format real kits, appending `rsvpCount: kit.party._count.guests` and `isPlaceholder: false`.

// 5. Format placeholder rows:
const placeholders = filteredPlaceholders.map(p => ({
  id: `placeholder:${p.id}`,
  partyId: p.id,
  partyName: p.name,
  eventDate: p.date?.toISOString() || null,
  region: p.region,
  hostName: p.user?.name || null,
  hostEmail: p.user?.email || null,
  eventAddress: p.address || null,
  eventVenue: p.venueName || null,
  underbossStatus: p.underbossStatus || 'pending',
  requestedTier: '',
  allocatedTier: null,
  recipientName: '',
  addressLine1: '',
  addressLine2: null,
  city: '',
  state: null,
  postalCode: '',
  country: '',
  phone: null,
  status: 'no_request',     // sentinel — frontend treats as placeholder badge
  trackingNumber: null,
  trackingUrl: null,
  notes: null,
  adminNotes: null,
  requestedAt: p.date?.toISOString() || new Date(0).toISOString(),
  approvedAt: null,
  shippedAt: null,
  deliveredAt: null,
  rsvpCount: p._count.guests,
  isPlaceholder: true,
}));

res.json({ kits: [...formattedKits, ...placeholders] });
```

### CSV export updates (`GET /kits/export`)
- Add header column `RSVPs` immediately after `Event Name`.
- Add `RSVPs` value (the integer) per row.
- Include placeholder rows in the export when `status` / `tier` / `country` filters are empty. For placeholders, leave shipping fields blank but populate `Event Name`, `Region`, `Host Name`, `Host Email`, `Event Venue`, `Event Address`, `Event Approved=Approved`, `RSVPs=N`, `Status=No request`.

### Stats endpoint (`GET /api/shipping/stats`)
- **Do NOT add an aggregate RSVP stat card** (user explicitly chose per-row only).
- **DO add `noRequest: number`** to the stats response. Compute it with a single Prisma count:
  ```ts
  const partyRegionFilter = req.shippingRegions!.includes('__admin__')
    ? {}
    : { region: { in: req.shippingRegions! } };
  const noRequest = await prisma.party.count({
    where: {
      ...partyRegionFilter,
      region: { not: null },
      underbossStatus: 'approved',
      partyKit: { is: null }, // verify relation name in schema.prisma
    },
  });
  stats.noRequest = noRequest;
  ```
- Update the `ShippingKitStats` TS type accordingly.

### Status validation
- Add `'no_request'` to `VALID_STATUSES` ONLY for query filtering — DO NOT accept it on PATCH/bulk-update. Easiest: keep `VALID_STATUSES` as-is for write paths and define a separate `VALID_LIST_STATUSES = [...VALID_STATUSES, 'no_request']` for the list endpoint, OR just special-case `status === 'no_request'` early in the list handler. Recommend the latter — simpler.

## Frontend changes

### `frontend/src/types.ts`
- Add to `ShippingKit`:
  ```ts
  rsvpCount: number;
  isPlaceholder?: boolean;
  ```
- Keep `recipientName`, `addressLine1`, `city`, `postalCode`, `country` as `string` (already are). Placeholder rows send empty strings — no type change needed. `requestedTier` is currently `KitTier` (`'basic' | 'large' | 'deluxe'`); placeholders need to send `''`. Two options:
  - **(A) [recommended]** Widen `requestedTier` to `KitTier | ''` (or `KitTier | null`) and let `KitRow` short-circuit on `isPlaceholder` before reading it. Lowest churn.
  - (B) Introduce `ShippingKitOrPlaceholder = ShippingKit | ShippingKitPlaceholder` discriminated union. Cleaner type but ripples through every consumer (`KitTable`, `KitRow`, `KitDetailModal`, the optimistic update lambdas in `ShippingDashboard.tsx`).
- Recommend (A): widen `requestedTier`/`allocatedTier`/`status` to allow the empty/no_request sentinel and gate every consumer on `isPlaceholder`.

### `frontend/src/components/shipping/KitTable.tsx`
- Add new `<SortHeader field="rsvpCount">RSVPs</SortHeader>` between Event and (showRegion?) Region — sortable.
- Bump the empty-state `colSpan` (currently `showRegion ? 10 : 9`) by +1.
- Toggle-all checkbox should select real kits only (filter out `isPlaceholder` before `new Set(kits.map(k => k.id))`).
- `selectedIds.size` display should reflect real kits selected.

### `frontend/src/components/shipping/KitRow.tsx`
- New `<td>` rendering `kit.rsvpCount` (e.g. `<span className="text-sm text-theme-text">{kit.rsvpCount}</span>`).
- If `kit.isPlaceholder`:
  - Render the checkbox cell as empty (`<td />`).
  - Render Recipient cell as `—`.
  - Render Tier cell as `—` (skip the `<select>` and Info button).
  - Render Status cell as a badge (e.g. `bg-gray-500/20 text-gray-700` or orange): `t('shipping.noKitRequest')`.
  - Render Tracking cell as `—` and Requested cell as `—`.
  - Eye/View button can still link to the event — or hide it. Recommend hide for phase 1.
- For real kits: render the existing controls plus the new RSVPs cell.

### `frontend/src/pages/ShippingDashboard.tsx`
- `handleStatusChange`, `handleTierChange`, `handleTrackingChange`, `handleDetailUpdate`, `handleBulkUpdate` — all should early-return / be unreachable for placeholder rows (because `KitRow` won't render the controls). No structural changes required.
- `sortedKits` memo: placeholders sort to the bottom for `requestedAt` / `status`. For `rsvpCount` they sort naturally by their count. Acceptable.
- `countries` memo: filter out empty strings so placeholders don't add a blank country entry to the country filter dropdown:
  ```ts
  const countries = useMemo(() => {
    const set = new Set(kits.map(k => k.country).filter(Boolean));
    return Array.from(set).sort();
  }, [kits]);
  ```

### `frontend/src/components/shipping/KitStats.tsx`
- Add a new `STAT_CARDS` entry between `declined` and `total`:
  ```ts
  { key: 'noRequest', label: 'No request', icon: AlertCircle, color: 'text-orange-500', bg: 'bg-orange-500/10' }
  ```
- Bump the grid from `lg:grid-cols-6` to `lg:grid-cols-7` (or wrap to two rows on smaller screens — confirm what looks best).
- When this card is clicked, call `onStatusFilter('no_request')` (the existing handler already swaps to `setStatusFilter`).
- `activeStatus === 'no_request'` should highlight the card.

### `frontend/src/components/shipping/KitFilters.tsx`
- Add a `<option value="no_request">No request</option>` to the status dropdown (verify component exists — search for the existing pending/approved/shipped options).

### i18n keys (add to all 7 locale files: `en/admin.json`, plus `de`, `es`, `fr`, `ja`, `pt`, `zh`)
Add inside the `"shipping"` block:
```json
"rsvpsColumn": "RSVPs",
"noKitRequest": "No kit request",
"noRequest": "No request",
"rsvpsTooltip": "Non-declined guests for this event"
```
Provide English copy in `en/admin.json`. For other locales, COPY the English strings as a placeholder so the keys exist and the UI doesn't show `shipping.rsvpsColumn` — call this out in the PR description so Snax can translate later.

## Verification steps

### Local
1. Backend: from `backend/`, run `npm test` (or whichever exists) and ensure `shipping.routes.ts` still compiles (`tsc --noEmit`).
2. Manually hit `GET /api/shipping/kits` as an admin (use auth cookie/JWT): confirm each kit has `rsvpCount: number` and `isPlaceholder: false`, and placeholder rows appear with `isPlaceholder: true` and synthesized `id`.
3. Hit `GET /api/shipping/kits?status=pending`: placeholders should be excluded.
4. Hit `GET /api/shipping/kits?region=usa` as admin and as a single-region coordinator scoped to `usa`: placeholders should appear only for US parties.
5. CSV export: hit `GET /api/shipping/kits/export` and confirm header has `RSVPs` and placeholder rows are present.
6. Frontend: `npm run dev`, log in as shipping admin, confirm new column renders, placeholders render with the gray "No kit request" badge, search by event name surfaces both real and placeholder, country filter hides placeholders.

### Vercel preview (after backend deploys to prod)
1. Visit the frontend preview URL for the PR branch — RSVPs column and placeholders should populate (backend is shared from prod).
2. Test on the admin account AND a single-region coordinator to confirm region scoping.

## Deploy order (CRITICAL)

Per project memory: **the backend only deploys from master**, and frontend Vercel previews share the production backend.

1. Open backend PR with the `shipping.routes.ts` changes — get review + merge to master.
2. After master merge, run `cd backend && vercel --prod --scope pizza-dao` to push the backend.
3. Only AFTER step 2, frontend Vercel preview URLs for this branch will return the new `rsvpCount` / placeholder fields. Before that, the preview will silently fall back to old data (and `rsvpCount` will be `undefined` — render defensively in `KitRow`: `{kit.rsvpCount ?? '—'}`).
4. Frontend PR can be opened in parallel but mark it "DO NOT MERGE until backend deployed".

## Out of scope / explicitly not doing

- No database migration; no new columns, no new tables, no GRANT.
- No bulk-action support targeting placeholder rows (they have no kit to update).
- No edit/create-kit-from-placeholder shortcut (could be a follow-up — e.g. an "Invite host to request a kit" email button).
- No aggregate RSVP stat card (per-row only).
