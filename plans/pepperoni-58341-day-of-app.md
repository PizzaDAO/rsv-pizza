# pepperoni-58341: Day-Of Event app for hosts

**Priority**: P1
**Type**: Full feature (worktree + draft PR + Vercel preview)
**Pizza-id**: `pepperoni-58341` (local-assigned; sheets-claude `create` is broken — Snax to backfill row)
**Branch**: `pepperoni-58341-day-of-app`

## Problem

On event day, a host bounces between ~5 HostPage tabs (Guests, Photos, Venue, Music, Checklist) and none of it is mobile-optimized. There's no single "where am I right now" dashboard, no broadcast channel to message guests live, no quick walk-in capture, no on-event photo/art display surface, and no mobile-first URL to pin to a phone home screen.

## Approach

Two surfaces, one feature set:
1. **`day-of` HostPage tab** — desktop view via the existing tab system.
2. **`/run/:inviteCode` mobile route** — phone view, auth-gated to host + cohosts.

Both render the same `<DayOfDashboard layout="desktop|mobile">` component.

**Reuse:** existing `POST /api/checkin/:inviteCode/:guestId`, `useGuestsRealtime` hook (host-only — never PizzaContext), PhotoGallery, MusicWidget data, ChecklistTab data, venue fields on Party.

**Build:** `POST /api/parties/:partyId/announce`, `POST /api/parties/:partyId/guests/walk-in`, 2 new `parties` columns, `announcements` audit table, `ArtDisplay` + `/display/:partyId/art` route, ~12 day-of components, GPP-only briefing card.

## Database

### Migration: `supabase/migrations/20260520_pepperoni_day_of_app.sql`

```sql
-- pepperoni-58341: Day-of event app

ALTER TABLE parties
  ADD COLUMN wifi_info     TEXT,
  ADD COLUMN parking_notes TEXT;

GRANT SELECT (wifi_info, parking_notes) ON parties TO anon, authenticated;

CREATE TABLE announcements (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  party_id        UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  sent_by         TEXT NOT NULL,
  channels        TEXT[] NOT NULL,
  subject         TEXT,
  body            TEXT NOT NULL,
  recipient_count INT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_announcements_party ON announcements(party_id, sent_at DESC);
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
```

### Prisma additions in `backend/prisma/schema.prisma`

Add to `Party`:
```prisma
wifiInfo       String? @map("wifi_info")
parkingNotes   String? @map("parking_notes")
announcements  Announcement[]
```

New model:
```prisma
model Announcement {
  id              String   @id @default(uuid())
  partyId         String   @map("party_id") @db.Uuid
  sentBy          String   @map("sent_by")
  channels        String[]
  subject         String?
  body            String
  recipientCount  Int?     @map("recipient_count")
  sentAt          DateTime @default(now()) @map("sent_at")
  createdAt       DateTime @default(now()) @map("created_at")

  party Party @relation(fields: [partyId], references: [id], onDelete: Cascade)

  @@index([partyId, sentAt(sort: Desc)])
  @@map("announcements")
}
```

**DO NOT apply the migration.** You have no Supabase MCP. The main session applies it before merge.

## Backend

### `POST /api/parties/:partyId/announce` in `backend/src/routes/party.routes.ts`

Per-route middleware `requireAuth, requirePartyAccess` (NEVER path-less `router.use(gate)` — broke prod once).

Body: `{ subject?: string, body: string, channels: ('telegram' | 'email')[] }`.
- Telegram: reuse pattern from `backend/src/routes/telegram.routes.ts:78`. Send to `party.telegramGroupId` if set, else skip silently.
- Email: Resend. Query guests where `partyId AND status='confirmed' AND email IS NOT NULL`. Individual sends (no BCC). Subject required when email in channels (400 otherwise).
- Insert `announcements` row with computed `recipient_count`.
- Return `{ announcementId, recipientCount, channelsSent: { telegram: boolean, email: number } }`.

### `POST /api/parties/:partyId/guests/walk-in` in `backend/src/routes/party.routes.ts`

Same per-route middleware. Body: `{ name: string, email?: string }`. Creates guest with `submitted_via='host-checkin'`, `status='confirmed'`, `approved=true`, `checked_in_at=now()`, `checked_in_by=req.userId`. Returns new row.

### `PATCH /api/parties/:id` allowlist

Add `wifiInfo`, `parkingNotes` to the PATCH handler field allowlist.

### Tab whitelist

Add `'day-of'` to `VALID_TAB_IDS` in `backend/src/helpers/partyAccess.ts`.

## Frontend — 7-place column add for wifi_info + parking_notes

Per CLAUDE.md "Common Gotchas." Migration + grant covered. Remaining sites:
1. `backend/prisma/schema.prisma` — Prisma fields above.
2. Backend PATCH handler allowlist — covered.
3. `frontend/src/lib/api.ts` `updatePartyApi` — add fields.
4. `frontend/src/lib/supabase.ts` `updateParty` — add fields. **Leave `safeColumns` alone** (host-only data).
5. `frontend/src/contexts/PizzaContext.tsx` `dbPartyToParty` — snake→camel map.
6. `DbParty` and `Party` TS interfaces — grep to find.

**Both `updateParty` AND `updatePartyApi` must be updated** — missing either = silent saves (garlic-34476 bug).

## Frontend — tab triplet

Add `'day-of'` to all THREE enumeration sites:
1. `frontend/src/pages/HostPage.tsx` TabType union (~line 46), render `<DayOfTab party={party} />`.
2. `frontend/src/lib/tabPermissions.ts` `ALL_HOST_TABS` (~line 53-71): label `'Day Of'`, pick a lucide icon (`Zap` or `Calendar`).
3. `backend/src/helpers/partyAccess.ts` `VALID_TAB_IDS` (~line 17-36).

Place visually after `dashboard`, before `details`.

## Frontend — new routes

In `frontend/src/App.tsx`:
```tsx
<Route path="/run/:inviteCode" element={<DayOfRunPage />} />
<Route path="/display/:partyId/art" element={<ArtDisplayPage />} />
```

`DayOfRunPage` (`frontend/src/pages/DayOfRunPage.tsx`): fetch party by inviteCode, gate on host/cohost auth, render `<DayOfDashboard party={party} layout="mobile" />` with NO `<Layout>` chrome.

`ArtDisplayPage`: full-bleed rotating slideshow of approved party photos, host/cohost auth (NOT anon).

## Frontend — `frontend/src/components/day-of/`

```
DayOfDashboard.tsx         — shell; layout="desktop" → CSS grid; layout="mobile" → stacked + sticky bottom action bar
StatusHeader.tsx           — countdown to start | checked-in / capacity | time elapsed if started
CheckInPanel.tsx           — searchable guest list w/ one-tap check-in; "Walk-in" button at top
WalkInModal.tsx            — IconInput for name + optional email → POST /guests/walk-in; no confirm
AnnouncePanel.tsx          — Telegram + Email checkboxes (both default ON), IconInput multiline body, optional subject (required when email checked), live preview pane, sticky "Send" button — NO confirm modal
AnnouncementHistory.tsx    — last 10 sent announcements: time, channels, recipient_count, body excerpt
LogisticsCard.tsx          — address (directions link), parking_notes, wifi_info, venueContactName/Phone (tap-to-call via tel:)
PizzaStatusCard.tsx        — selectedPizzerias + contact info + "Order placed" checkbox in localStorage
MusicNowPlayingCard.tsx    — top playlist + first 3 songs from MusicWidget data; "Open Music tab" link
ChecklistTodayCard.tsx     — ChecklistTab items filtered by DAY_OF_ITEM_NAMES; only un-done
PhotoQuickCaptureCard.tsx  — big "Take a Photo" button with <input type="file" accept="image/*" capture="environment">; uploads via existing PhotoGallery upload handler
ArtDisplay.tsx             — full-bleed slideshow of approved party Photos, 8s per slide
BriefingCard.tsx           — see "Briefing card" below
DayOfTab.tsx               — thin wrapper rendering <DayOfDashboard layout="desktop" />
```

### Briefing card

Create `frontend/src/lib/dayOfBriefing.ts`:

```ts
export const PIZZADAO_BRIEFING = {
  timing: 'Make this announcement about 1 hour into your event. Afterwards, hand the mic to your major partners — brief them that their announcement should be 1–3 minutes.',
  script: `PizzaDAO is an international pizza co-op that has thrown a Global Pizza Party every Bitcoin Pizza Day since 2021. Today, we're bringing together well over 20,000 people across hundreds of parties in more than 100 countries. We've spent well over $1 million dollars on pizza since we started!

Beyond the Global Pizza Party, we throw pizza parties all year around crypto conferences. You might have been to one!

For the rest of 2026, we'll be focused on building open source software solutions for independent pizzerias.

Want to be part of PizzaDAO? Join at pizzadao.org. You can also support us by minting a Rare Pizza NFT at rarepizzas.com`,
};
```

`BriefingCard.tsx`:
- Visible ONLY for GPP parties — grep Party type for `is_gpp_2026` / `gpp_status`; prefer `gpp_status === 'approved'` if both exist.
- Header bar: `~1 hour into event — then hand mic to partners, 1–3 min each`.
- Body: `PIZZADAO_BRIEFING.script` with preserved line breaks, `text-lg leading-relaxed`.
- Bottom "Done" checkbox → localStorage `dayof.briefing.done.{partyId}`. Done = dim to 50% opacity.
- Time window: when `Date.now()` ∈ [eventStart+50min, eventStart+90min], render this card FIRST in the dashboard grid with a subtle accent border (not `animate-pulse` — too aggressive).

### Day-of checklist allowlist

In `ChecklistTodayCard.tsx`:
```ts
const DAY_OF_ITEM_NAMES = new Set([
  'Confirm pizza delivery time',
  'Set up check-in table',
  'Test sound system',
  'Greet first guests',
  'Take group photo',
  'Pay venue final invoice',
]);
```

### Realtime

`DayOfDashboard` and ONLY `DayOfDashboard` calls `useGuestsRealtime(party.id)`. Do NOT touch PizzaContext.

## What's NOT in scope

No cohost on-site indicator, no SMS, no run-of-show editor (only the briefing card auto-promotes), no per-pie ETA, no weather, no `category` column on ChecklistItem (deferred).

## Defaults (Snax dispatched without resolving open questions)

- Telegram + Email channel checkboxes both default ON.
- Walk-in: name + optional email.
- URL: `/run/`.
- Checklist allowlist: the 6 items above.
- Art display: party photos only.
- Briefing card: GPP-only (hidden for non-GPP).
