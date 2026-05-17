# olive-92973 — Admin-only newsletter signup counts on /partner

## Goal

On the `/partner` (PartnerDashboardPage) page, show newsletter signup counts so PizzaDAO admins can see at-a-glance how many guests opted in to:

- **PizzaDAO mailing list** (`guests.mailing_list_opt_in`)
- **SWC newsletter** — sum across all six regional variants (`swc_opt_in`, `swc_ca_opt_in`, `swc_au_opt_in`, `swc_eu_opt_in`, `swc_uk_opt_in`, `swc_br_opt_in`)

**Visibility is admin-only.** Partners must NOT see these numbers, neither in the aggregate stats grid nor on individual EventCards. The frontend conditional + backend conditional both gate on the admin flag (defense in depth).

## Where it should appear

Two places:

1. **Aggregate stats grid** at the top of `/partner` (alongside Events / Total RSVPs / Impressions / Partner Link Clicks)
   - One new tile: **"PizzaDAO Newsletter"** — total `mailingListOptIn` count across all filtered events
   - One new tile: **"SWC Newsletter"** — total across all 6 SWC variants, with per-region breakdown sub-list (matches the existing partner-clicks tile's nested-breakdown pattern)

2. **Each EventCard** — a small admin-only row showing per-event PizzaDAO + SWC signup counts. Add it inline near the existing per-event stats row (the one with Eye/views, MousePointerClick/clicks). Keep it tight — single line like `📧 PizzaDAO: 12 · SWC: 5` style.

## Implementation

### Backend — `backend/src/routes/sponsor-user.routes.ts`

**File**: `backend/src/routes/sponsor-user.routes.ts` (the `/api/sponsor/events` handler, around line 519)

1. In the `guests` Prisma select (around line 547), add the opt-in boolean columns:

   ```ts
   guests: {
     select: {
       id: true,
       approved: true,
       checkedInAt: true,
       status: true,
       // Newsletter opt-in fields (admin-only response)
       mailingListOptIn: true,
       swcOptIn: true,
       swcCaOptIn: true,
       swcAuOptIn: true,
       swcEuOptIn: true,
       swcUkOptIn: true,
       swcBrOptIn: true,
     },
   },
   ```

2. In the per-event formatting block (around line 689), compute counts. **Only count guests with `status !== 'INVITED'`** — matching how `rsvpCount` is computed (invited bulk guests haven't actually submitted the RSVP form). This is the same fake-detection-friendly filter the codebase already uses.

3. Add a `newsletterSignups` field to the returned event object, **but only when `req.isAdminViewing` is true** (don't leak the field at all to partners):

   ```ts
   // inside formattedEvents map
   const submittedGuests = event.guests.filter(g => g.status !== 'INVITED');
   const newsletterSignups = req.isAdminViewing ? {
     pizzadao: submittedGuests.filter(g => g.mailingListOptIn).length,
     swc: submittedGuests.filter(g => g.swcOptIn).length,
     swcCa: submittedGuests.filter(g => g.swcCaOptIn).length,
     swcAu: submittedGuests.filter(g => g.swcAuOptIn).length,
     swcEu: submittedGuests.filter(g => g.swcEuOptIn).length,
     swcUk: submittedGuests.filter(g => g.swcUkOptIn).length,
     swcBr: submittedGuests.filter(g => g.swcBrOptIn).length,
   } : undefined;

   return {
     // ... existing fields ...
     newsletterSignups, // undefined for non-admins, dropped by JSON.stringify
   };
   ```

### Frontend — types

**File**: `frontend/src/types.ts`

Add optional field to `SponsorDashboardEvent` (around line 1265, near the existing `photoCount`):

```ts
newsletterSignups?: {
  pizzadao: number;
  swc: number;
  swcCa: number;
  swcAu: number;
  swcEu: number;
  swcUk: number;
  swcBr: number;
};
```

Field is optional because partners won't receive it.

### Frontend — PartnerDashboardPage

**File**: `frontend/src/pages/PartnerDashboardPage.tsx`

#### Aggregate stats grid

Inside the existing stats-computation block (around line 568, `allEvents.length > 0 && (() => { ... })()`), add aggregated newsletter sums **only when `dashboardData?.isAdmin`**:

```ts
const isAdmin = dashboardData?.isAdmin === true;
const newsletterTotals = isAdmin ? allEvents.reduce((acc, e) => {
  const n = e.newsletterSignups;
  if (n) {
    acc.pizzadao += n.pizzadao;
    acc.swc += n.swc;
    acc.swcCa += n.swcCa;
    acc.swcAu += n.swcAu;
    acc.swcEu += n.swcEu;
    acc.swcUk += n.swcUk;
    acc.swcBr += n.swcBr;
  }
  return acc;
}, { pizzadao: 0, swc: 0, swcCa: 0, swcAu: 0, swcEu: 0, swcUk: 0, swcBr: 0 }) : null;
const swcTotal = newsletterTotals
  ? newsletterTotals.swc + newsletterTotals.swcCa + newsletterTotals.swcAu + newsletterTotals.swcEu + newsletterTotals.swcUk + newsletterTotals.swcBr
  : 0;
```

Then render two new tiles **after the partner-link-clicks tile** (so before the SWC `withVenue`/`withBudget`/`completion` cluster), wrapped in `{isAdmin && newsletterTotals && (...)}`:

- **PizzaDAO Newsletter** tile — uses `Mail` icon from `lucide-react`, shows `newsletterTotals.pizzadao.toLocaleString()`.
- **SWC Newsletter** tile — uses `Send` (or `Mail`) icon, shows `swcTotal.toLocaleString()` as the headline number, then a breakdown sub-list under a divider styled like the existing partner-link-clicks breakdown. Show one line per SWC variant that has count > 0, formatted like:

  ```
  Global  12   CA 3   AU 1
  ```

  Use the labels:
  - `swc` → "Global"
  - `swcCa` → "Canada"
  - `swcAu` → "Australia"
  - `swcEu` → "Europe"
  - `swcUk` → "UK"
  - `swcBr` → "Brazil"

Use the same Tailwind classes the existing tiles use (`bg-theme-card border border-theme-stroke rounded-xl p-4`, etc.) so the new tiles match visually.

Update the grid wrapper class to fit 6 tiles in a non-SWC view too: change `lg:grid-cols-4` so it expands when admin tiles are present. Suggested:

- Non-SWC + admin: `grid-cols-2 md:grid-cols-3 lg:grid-cols-6` (6 tiles: Events, Total RSVPs, Impressions, Clicks, PizzaDAO, SWC)
- SWC + admin: keep `lg:grid-cols-5` for the original cluster and let the 2 admin tiles wrap (or expand to `lg:grid-cols-7` if it fits)
- Non-admin: unchanged (`lg:grid-cols-4` non-SWC / `lg:grid-cols-5` SWC)

Pick whichever wrapping looks clean at common widths — verify in the Vercel preview.

#### Per-EventCard row

In the `EventCard` component (starts around line 810), thread `isAdmin` down via a prop (the parent passes it from `dashboardData?.isAdmin`).

After the existing impressions/clicks row (around line 1060), add:

```tsx
{isAdmin && event.newsletterSignups && (
  (() => {
    const n = event.newsletterSignups;
    const swcSum = n.swc + n.swcCa + n.swcAu + n.swcEu + n.swcUk + n.swcBr;
    if (n.pizzadao === 0 && swcSum === 0) return null;
    return (
      <div className="flex items-center gap-3 text-xs text-theme-text-muted">
        {n.pizzadao > 0 && (
          <span className="flex items-center gap-1.5">
            <Mail size={12} />
            <span>PizzaDAO: <span className="font-semibold text-theme-text">{n.pizzadao}</span></span>
          </span>
        )}
        {swcSum > 0 && (
          <span className="flex items-center gap-1.5">
            <Send size={12} />
            <span>SWC: <span className="font-semibold text-theme-text">{swcSum}</span></span>
          </span>
        )}
      </div>
    );
  })()
)}
```

Don't render anything for events with zero signups (avoid empty noise on every card).

### i18n

The two new stat-tile titles ("PizzaDAO Newsletter", "SWC Newsletter") and per-region labels should ideally go through `useTranslation('partner')` if the rest of the dashboard does (it does — `t('dashboard.totalRsvps')` etc.). Add new keys to `frontend/src/i18n/locales/en/partner.json` (and the other 6 locales — copy English for now, mark non-EN as TODO). Keys to add:

- `dashboard.newsletterPizzadao` = "PizzaDAO Newsletter"
- `dashboard.newsletterSwc` = "SWC Newsletter"
- `dashboard.newsletterSwcRegion.global` = "Global"
- `dashboard.newsletterSwcRegion.canada` = "Canada"
- `dashboard.newsletterSwcRegion.australia` = "Australia"
- `dashboard.newsletterSwcRegion.europe` = "Europe"
- `dashboard.newsletterSwcRegion.uk` = "UK"
- `dashboard.newsletterSwcRegion.brazil` = "Brazil"
- `eventCard.newsletterPizzadao` = "PizzaDAO" (short label for per-card row)
- `eventCard.newsletterSwc` = "SWC"

If the file structure makes the i18n addition heavy, English-only hardcoded strings are acceptable for the first cut — Snax can localize in a follow-up if it ships clean.

## Files Modified

- `backend/src/routes/sponsor-user.routes.ts` — add opt-in columns to guests select; compute and conditionally include `newsletterSignups` in response (admin-only).
- `frontend/src/types.ts` — add `newsletterSignups` optional field to `SponsorDashboardEvent`.
- `frontend/src/pages/PartnerDashboardPage.tsx` — two new admin-only stat tiles; per-EventCard admin-only signup row; thread `isAdmin` prop down.
- `frontend/src/i18n/locales/en/partner.json` (+ other 6 locales) — new translation keys.

## Verification

- [ ] Log in as a sponsor user (non-admin) → confirm no PizzaDAO/SWC tiles appear in stats grid AND no signup row on EventCards.
- [ ] Log in as an admin (Snax's account) → confirm both tiles appear in stats grid showing real counts.
- [ ] Filter to `tag=swc` as admin → confirm SWC tile shows breakdown with per-region numbers.
- [ ] Filter to `tag=pizzadao` as admin → confirm PizzaDAO tile shows a non-zero number (PizzaDAO mailing-list signups across all GPP events).
- [ ] Inspect network response on `/api/sponsor/events` as a non-admin → confirm `newsletterSignups` field is absent (not just zeroed) for defense in depth.
- [ ] Per-EventCard row hides itself when both PizzaDAO and SWC counts are zero (don't clutter cards with empty rows).

## Notes / Open Questions

- Counts include all guests with `status !== 'INVITED'`. This matches `rsvpCount` semantics — INVITED bulk guests haven't actually submitted the RSVP form, so their opt-in booleans are default-false and shouldn't be counted regardless.
- We don't filter by `submitted_via` (link/host/host-checkin/rsvp/api). All submission paths contribute. If Snax later wants only `link`/`rsvp`/`api` (excluding host-added), that's a one-line filter change.
- No DB migration. All columns already exist (per `backend/prisma/schema.prisma` lines 224–230).
- No new Supabase column-level SELECT grants needed — the backend reads these via Prisma using the service role.
