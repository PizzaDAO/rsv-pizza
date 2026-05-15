# sausage-37705 — Hide guest counts on GPP events

## Goal
On the public EventPage, hide the running guest count for all GPP events (`event.eventType === 'gpp'`). Keep the "X spots left" / sold-out indicator, but only display it when fewer than 20 spots remain (creates urgency near capacity without revealing raw attendance for less-full events).

## Scope
- **Public EventPage only.** Do NOT touch HostPage, RSVPPage, AdminPage, UnderbossDashboard, or any host/admin view. Hosts and admins still need to see counts.
- Applies to ALL events where `event.eventType === 'gpp'`, regardless of `underbossStatus`.
- Non-GPP events: no change in behavior.

## Files to Modify
- `frontend/src/pages/EventPage.tsx` — two near-identical guest-count blocks:
  - Desktop block at ~lines 725–744 (inside the host card column, under host avatars)
  - Mobile block at ~lines 1044–1063 (under "Mobile: Guest Count" comment)

## Current Behavior
Both blocks render, when `!event.hideGuests`:
```
<Users icon> {t('guest', { count: event.guestCount })}{event.maxGuests && ` / ${event.maxGuests}`}
  {if guestCount >= maxGuests} <span>{t('waitlistOpen')}</span>
  {if guestCount < maxGuests}  <span>{t('spotsLeft', { count: maxGuests - guestCount })}</span>
```

## New Behavior

Let `isGpp = event.eventType === 'gpp'` and `spotsRemaining = event.maxGuests ? event.maxGuests - event.guestCount : null`.

| Event type | guestCount text | spotsLeft / waitlistOpen |
|---|---|---|
| Non-GPP | show (unchanged) | show (unchanged) |
| GPP, no maxGuests | hide entire row | n/a (hide entire row) |
| GPP, ≥20 spots left | hide entire row | hide |
| GPP, <20 spots left (but >0) | hide count | show "X spots left" |
| GPP, sold out (`guestCount >= maxGuests`) | hide count | show waitlist/sold-out badge |

In other words, for GPP events: never show the running count number; show the spots-left/waitlist status only when fewer than 20 spots remain (sold out counts as <20).

Respect the existing `!event.hideGuests` gate at the outer wrapper (if a host has set hideGuests, keep hiding everything).

## Implementation Notes
- Two duplicate JSX blocks. Apply the same change to both. Don't refactor into a shared component as part of this task — keep the diff minimal and matching the existing structure.
- Suggested approach inside each block:
  ```tsx
  {!event.hideGuests && (() => {
    const isGpp = event.eventType === 'gpp';
    const spotsRemaining = event.maxGuests != null ? event.maxGuests - event.guestCount : null;
    const isSoldOut = spotsRemaining != null && spotsRemaining <= 0;
    const showSpotsLeft = spotsRemaining != null && spotsRemaining > 0 && spotsRemaining < 20;
    if (isGpp && !isSoldOut && !showSpotsLeft) return null;
    return (
      <div className="..."> {/* existing wrapper */}
        <div className="..."> {/* existing flex row */}
          <Users className="w-4 h-4" />
          {!isGpp && (
            <span>
              {t('guest', { count: event.guestCount })}
              {event.maxGuests && ` / ${event.maxGuests}`}
            </span>
          )}
          {isSoldOut && <span className="text-[#ffc107] text-xs">{t('waitlistOpen')}</span>}
          {showSpotsLeft && (
            <span className="text-theme-text-muted text-xs">
              {t('spotsLeft', { count: spotsRemaining! })}
            </span>
          )}
        </div>
      </div>
    );
  })()}
  ```
  IIFE pattern is fine; or pull `isGpp`/`spotsRemaining` up near other derived state (e.g., near `isFutureEvent`) and compute once. Either is acceptable — pick whichever fits the existing style of the file.
- Be careful: do NOT break the non-GPP path. The visual output for non-GPP events must be byte-identical to current.
- Keep the desktop wrapper's classes (`pt-4 border-t border-theme-stroke mt-4`) and the mobile wrapper's classes (`md:hidden pt-4 border-t border-theme-stroke`) exactly as they are.

## Verification
- [ ] On a GPP event with no `maxGuests`: guest-count row not rendered.
- [ ] On a GPP event with `maxGuests=100` and `guestCount=10` (90 left): guest-count row not rendered.
- [ ] On a GPP event with `maxGuests=100` and `guestCount=85` (15 left): row shows only "15 spots left", no count.
- [ ] On a GPP event with `maxGuests=100` and `guestCount=100` (sold out): row shows only "waitlist open" badge, no count.
- [ ] On a non-GPP event: row renders exactly as before (count + spots/waitlist).
- [ ] `hideGuests=true`: nothing rendered, both event types.
- [ ] Both desktop (md:) and mobile views match the rules above.
- [ ] TypeScript compile clean (`npm run typecheck` in frontend if available, else `npm run build`).

## Out of Scope
- HostPage, RSVPPage, AdminPage, UnderbossDashboard, PartnerDashboardPage — do NOT touch.
- Any backend / Prisma / Supabase changes — none needed.
- Refactoring the duplicate desktop/mobile blocks into a shared component.
- i18n string changes.
