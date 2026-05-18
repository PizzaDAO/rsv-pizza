# napoletana-92383: Admin click-through on /partners "in X events"

**Priority**: P3
**Type**: Feature
**Branch**: `napoletana-92383-partners-admin-click`
**Preview**: `https://rsvpizza-git-napoletana-92383-partners-admin-click-pizza-dao.vercel.app/partners`

## Goal

When an admin / underboss / graphics admin is logged in and visits `/partners`, make the "in N events" pill on each logo tile **clickable**. Clicking it opens a modal listing every event that lists that partner, with each event clickable:

| Visitor role | Click on "in X events" | Click on event in modal |
|---|---|---|
| Public (logged out) | No-op (pill stays display-only) | — |
| Admin / Underboss | Opens events modal | Navigates to `/{slug}` (the public event page) |
| Graphics admin | Opens events modal | Navigates to `/graphics/{slug}/edit?openSponsor={sponsorId}` with that partner's edit modal pre-opened on the flyer generator |

Single modal, role-dependent click targets — simpler than two flows.

## Changes required

### 1. Backend — `backend/src/routes/gpp.routes.ts`

The current `GET /api/gpp/partners` response includes `events: [{slug, city}]` per partner. Extend each event entry to also carry `sponsorId` (the per-event `Sponsor` row id, which the graphics admin link needs to deep-link to the right modal).

- In the `findMany` `select`, the `id` field on `Sponsor` is already implicit (Prisma always returns `id` unless `select` is restrictive). Confirm by re-reading the current `select`; if `id` isn't selected, add it.
- In the aggregation loop, when appending an event to a partner's `events` array, also store `sponsorId: row.id`.
- Update the `GPPPartner` response type doc in `backend/src/index.ts` (`<h2>Partners</h2>` block) to reflect the added field.

### 2. Frontend — `frontend/src/lib/api.ts`

Update the `GPPPartner` TypeScript interface — add `sponsorId: string` to the `events` array entry shape:

```ts
events: { slug: string; city: string; sponsorId: string }[];
```

### 3. Frontend — `frontend/src/pages/PartnersPage.tsx`

#### Role detection
- On mount, call `fetchAdminMe()` (already in `lib/api.ts:2410`). Pattern reference: `EventsMapPage.tsx:47` (`if (me.isAdmin || me.isUnderboss) { ... }`).
- Store `{ isAdmin, isUnderboss, isGraphicsAdmin }` in component state. Default to all-false on 401 (the fetch fails for logged-out users — catch and silently default).
- `canClick = isAdmin || isUnderboss || isGraphicsAdmin`.

#### Tile rendering
- When `canClick`, render the "in N events" pill as a `<button>` (not a `<span>`). Style: existing pill styling + `cursor-pointer hover:scale-105 transition-transform`. **Important**: stop event propagation on click so it doesn't trigger the outer `<a>` that wraps the tile.
- When `!canClick`, leave the pill as a `<span>` (no behavior change).
- Click handler: `setModalPartner(partner)`.

#### Modal
- Add a single modal component inline (don't create a new file). Use the project's standard modal pattern from CLAUDE.md: `fixed inset-0 z-50 bg-black/60 backdrop-blur-sm` backdrop + centered white card.
- Backdrop click closes; ESC key closes; close button (X) in top-right.
- Card content:
  - Header: partner logo (small, 64x64 on gray bg square), partner name in Bangers font, "in N events" subhead.
  - Scrollable list of events (`max-h-[60vh] overflow-y-auto`). Each row: city name + slug. On click, navigate based on role:
    - `isGraphicsAdmin` (and NOT admin/underboss -> check `isGraphicsAdmin` first since it's the more specific role): `navigate('/graphics/' + slug + '/edit?openSponsor=' + sponsorId)`
    - Otherwise: `navigate('/' + slug)`
  - Use `react-router-dom`'s `useNavigate`.
- Style the modal card so it looks coherent with the rest of the GPP visual identity: rounded-2xl, shadow-xl, padding, but white background (not gray - readability of the event list matters more than aesthetic consistency).

### 4. Frontend — `frontend/src/components/flyer/FlyerGenerator.tsx`

The flyer generator already has `const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null);` (line 64). Add a `useEffect` that reads `?openSponsor=<id>` from `useSearchParams` on mount and, once `party?.sponsors` is loaded, sets `editingSponsor` to the matching one.

```tsx
import { useSearchParams } from 'react-router-dom';
// ...
const [searchParams] = useSearchParams();
const openSponsorId = searchParams.get('openSponsor');
useEffect(() => {
  if (!openSponsorId || !party?.sponsors?.length) return;
  const target = party.sponsors.find(s => s.id === openSponsorId);
  if (target) setEditingSponsor(target);
}, [openSponsorId, party?.sponsors]);
```

Place the effect near the other useEffect hooks at the top of the component. Don't run repeatedly - the dependency on `openSponsorId` ensures it only fires when the URL has the param.

## Constraints

- **Do NOT** change anything else on the partners page (gradient, header, hero, grid, gray-cards work that just shipped).
- **Do NOT** add new components or new files. Modal is inline in `PartnersPage.tsx`.
- **Do NOT** change the public response shape beyond adding `sponsorId` to event entries.
- Reuse `fetchAdminMe` - don't roll a new role-check fetcher.
- 401 from `fetchAdminMe` is normal for logged-out users - catch silently.

## Verification

1. `cd backend && npx tsc --noEmit` - passes.
2. `cd frontend && npx tsc --noEmit` - passes.
3. Hit `/api/gpp/partners` on local backend - confirm `sponsorId` appears on each event entry.
4. Confirm public view: pill not clickable, no modal.
5. Confirm logged-in admin view: pill clickable, modal opens, event link goes to `/{slug}`.
6. Confirm graphics-admin view: pill clickable, modal opens, event link goes to `/graphics/{slug}/edit?openSponsor={id}` and that page opens the right sponsor's edit modal.

## Deploy order

Backend change is additive (new field on response). Frontend depends on it only for graphics admin path. Standard sequence:
1. Merge PR -> backend deploys (`vercel --prod --scope pizza-dao`).
2. Frontend auto-deploys.
3. Verify all three role paths.

## Out of scope / open questions

1. **Bulk SponsorUser-level logo update.** Graphics admin currently has to fix one event's flyer at a time. If they want "update the logo everywhere at once", that's the `PartnerManager` in /underboss, not this feature. Could add a "edit master partner record" button in the modal for graphics admin in a follow-up.
2. **City name cleanup.** Earlier curl showed cities like "Seoul  Give Your Agent a Pizza" - the "Global Pizza Party {City}" strip in the aggregator doesn't handle all naming variations. Separate task.
3. **Stand With Crypto / Stand With Crypto EU dedupe collision.** Open Q4 from stromboli-48177.
