# prosciutto-94651 — /map InfoWindow: hide RSVP count pill

## Problem
The `/map` event-card InfoWindow currently shows a red "N RSVPs" pill next to the "View Event →" / "Telegram →" links. Snax doesn't want guest counts visible on the public-facing map.

## Scope
Remove the RSVPs pill from `buildInfoContent` in `GPPEventsMap.tsx`. Everything else stays:
- Floating top-of-map stats badge ("N events across M cities") stays.
- "View Event →" and "Telegram →" links stay.
- The `rsvpCount` field stays on `GPPEventMapItem` (other consumers of the type — if any — are unaffected, and removing it isn't worth the type churn).

## Files to change

### `frontend/src/components/GPPEventsMap.tsx`

In `buildInfoContent` (around line 128), delete the `rsvpHtml` const:
```ts
const rsvpHtml = `<span style="background:#fef2f2;color:#E52828;font-size:11px;padding:2px 8px;border-radius:9999px;font-weight:500">${event.rsvpCount.toLocaleString()} RSVPs</span>`;
```

In the returned template literal (around line 138–141), remove `${rsvpHtml}` from the bottom flex row:
```html
<div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
  ${linkHtml}
  ${telegramHtml}
</div>
```

If only `linkHtml` ends up in the row when there's no telegram link, the flex row still renders cleanly with one item — no further markup change needed.

## Verification
- Open `/map` preview as an underboss.
- Click any marker — InfoWindow should show name, date, venue, address, "View Event →", and optionally "Telegram →", but **no** RSVP count pill.
- Floating top badge ("N events across M cities") still appears.

## Out of scope
- Removing the underboss auth gate. The page is still protected; "public" in the task title refers to the *content shown in the InfoWindow* — what would be visible if/when the page is made public, not a change to access today.
- Removing `rsvpCount` from `GPPEventMapItem`, `GPPEventApiResponse`, or the backend response. The API field stays; we just don't render it on the map.
- Any other map UX changes.

## Notes
- Frontend-only change. No backend deploy needed.
