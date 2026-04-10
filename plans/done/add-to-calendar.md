# Add to Calendar Feature

## Summary
Clicking/tapping the date on an event page opens a popup with options to add the event to Google Calendar, Apple Calendar (.ics), or Outlook. The .ics files include VALARM reminders for **1 day** and **1 hour** before the event.

## Data Available
`PublicEvent` already has everything needed: `name`, `date`, `duration`, `timezone`, `address`, `venueName`, `description`. EventPage already computes `eventDate`, `endDate`, formatted strings, etc.

## Architecture
**No library needed** — .ics format is ~30 lines, Google/Outlook URLs are simple string construction. The project already has `stripMarkdown()` and date utilities.

## Files to Create

### 1. `frontend/src/utils/calendarUtils.ts`
- `generateICSFile(event)` — produces ICS string with two VALARM blocks:
  - `TRIGGER:-P1D` (1 day before)
  - `TRIGGER:-PT1H` (1 hour before)
- `generateGoogleCalendarUrl(event)` — Google Calendar URL (note: no reminder param support, users get Google's defaults)
- `generateOutlookUrl(event)` — Outlook web deep link
- `downloadICSFile(icsContent, filename)` — blob download helper

### 2. `frontend/src/components/AddToCalendarPopup.tsx`
Lightweight dropdown (not full modal) anchored below the date section:
- Three buttons: Google Calendar, Apple Calendar (.ics download), Outlook
- Theme: `bg-theme-header`, `border-theme-stroke`, `rounded-xl`, `shadow-xl`
- Click outside / ESC to close
- On mobile: bottom-sheet via `createPortal`

## Files to Modify

### `frontend/src/pages/EventPage.tsx`
- Add `showCalendarPopup` state + ref
- Wrap both desktop (lines 787-808) and mobile (lines 878-899) date sections with `cursor-pointer` + `onClick`
- Hover cue: calendar icon border turns red on hover
- Only for future events: `eventDate.getTime() > Date.now()`
- Render `AddToCalendarPopup` conditionally

## Edge Cases
- No `duration` → default to 2 hours
- No `timezone` → use UTC
- No `address` → use `venueName` or empty string
- Markdown description → `stripMarkdown()` + truncate to ~500 chars
- iOS .ics download → auto-prompts Apple Calendar
- Past events → no click handler, no hover cue

## Google Calendar Limitation
Google Calendar's URL API does **not** support reminder parameters. Users get default reminders. For custom reminders, they can use the .ics download which preserves VALARM blocks.

## Step-by-Step Implementation
1. Create `calendarUtils.ts` with ICS generation, URL builders, download helper
2. Create `AddToCalendarPopup.tsx` with 3 calendar options
3. Modify `EventPage.tsx` — add state, click handler on date sections, render popup
4. Test on desktop + mobile, verify .ics downloads work and contain reminders
