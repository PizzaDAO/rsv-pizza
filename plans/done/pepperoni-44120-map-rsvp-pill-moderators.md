# pepperoni-44120 — /map InfoWindow: restore RSVP pill for moderators

## Problem
`prosciutto-94651` removed the RSVP count pill from `/map` event-card InfoWindows for everyone. Snax wants admin / underboss viewers to still see RSVP counts; only the public view should hide them.

## Current state (master)
`GPPEventsMap.tsx` already receives a `canModerate` prop from `EventsMapPage`. `buildInfoContent` already branches on `canModerate` to render moderator-only content: a status pill (`approved` / `pending` / `rejected` / …) and Approve/Reject buttons, wrapped in an `actionsRowHtml` `<div>` that only renders when `canModerate`. RSVPs are not rendered today.

## Scope
Inside the existing `if (canModerate) { … }` block in `buildInfoContent`, add an RSVP count pill and place it next to the status pill in the moderator actions row. No new props, no API change, no impact on public viewers.

## Files to change

### `frontend/src/components/GPPEventsMap.tsx`

In `buildInfoContent`, inside `if (canModerate) {` (around the line that declares `const statusPillHtml = …`), add right after it:

```ts
const rsvpPillHtml = `<span style="background:#fef2f2;color:#E52828;font-size:11px;padding:2px 8px;border-radius:9999px;font-weight:500">${event.rsvpCount.toLocaleString()} RSVPs</span>`;
```

Then in each of the three `actionsHtml = \`…\`` branches, insert `${rsvpPillHtml}` immediately after `${statusPillHtml}`. Result for the three branches:

- `approved`:
  ```
  ${statusPillHtml}
  ${rsvpPillHtml}
  <button data-action="reject" …>Mark rejected</button>
  ```
- `rejected`:
  ```
  ${statusPillHtml}
  ${rsvpPillHtml}
  <button data-action="approve" …>Mark approved</button>
  ```
- `else` (pending / listed / hidden):
  ```
  ${statusPillHtml}
  ${rsvpPillHtml}
  <button data-action="approve" …>Approve</button>
  <button data-action="reject" …>Reject</button>
  ```

Style matches the original prosciutto-94651-deleted pill exactly (red `#fef2f2` bg, `#E52828` text, rounded). The `actionsRowHtml` flex container already has `gap:8px; flex-wrap:wrap` so it'll lay out cleanly.

## Verification
- `/map` preview as a logged-out / non-moderator user: InfoWindow shows name, date, venue, address, "RSVP →", optional "Telegram →" — **no** status pill, **no** RSVP count, **no** action buttons.
- `/map` preview as an admin or underboss: InfoWindow shows everything above (with "View Event →" instead of "RSVP →") **plus** the actions row containing status pill + RSVP count pill + Approve/Reject buttons.

## Out of scope
- Adding RSVP count to the public view in any form.
- Restyling the actions row, changing pill positions, or adding new state.
- Backend or API changes — `rsvpCount` is already on `GPPEventMapItem`.

## Notes
- Frontend-only. No backend deploy.
- The InfoWindow re-renders on event updates (post-approve/reject) via `buildInfoContent(latest)`, so the pill updates in lockstep with status changes if relevant.
