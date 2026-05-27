# margherita-58471: T-4h automated email reminders for approved RSVP'd guests

## Goal

Email every approved guest with an `email` set a single reminder ~4 hours before
the event starts. Per-event toggle (default ON), per-guest one-click unsubscribe.
English-only, no SMS, no second reminder.

## Design

- **Scheduling**: Vercel cron on the backend project at `*/15 * * * *` hitting
  `GET /api/cron/event-reminders`. Cron is authenticated via
  `Authorization: Bearer ${CRON_SECRET}` (constant-time compare).
- **Window**: events with `date BETWEEN NOW()+3h45m AND NOW()+4h15m` (so every
  approved guest is picked up exactly once even if a tick is slightly late).
- **Deduplication**: a single atomic
  `UPDATE guests SET reminder_sent_at = NOW() … WHERE reminder_sent_at IS NULL
  RETURNING …` claims each guest. Subsequent ticks skip already-claimed rows.
- **Retry**: if the Resend send fails for a claimed row, we roll back its
  `reminder_sent_at` so the next 15-minute tick will retry it. There is no
  separate log table — `reminder_sent_at` is the audit trail.
- **Concurrency**: per tick we send at most 5 emails in parallel via a small
  sliding-worker-pool helper.
- **Unsubscribe**: HMAC-SHA256 over `guestId` (16-byte truncated, base64url),
  signed with `UNSUBSCRIBE_SECRET`. `GET/POST /api/reminders/unsubscribe?g=…&s=…`
  flips `reminders_unsubscribed = TRUE` and renders a small dark-themed HTML page.
  RFC 8058 headers (`List-Unsubscribe` + `List-Unsubscribe-Post`) make it
  one-click in Gmail/Outlook.
- **Host control**: `parties.reminders_enabled` (default TRUE). Surfaced in
  EventDetailsTab as a Checkbox in the optional-fields section.

## Database — `supabase/migrations/20260521_event_reminders.sql`

```sql
ALTER TABLE parties
  ADD COLUMN reminders_enabled BOOLEAN NOT NULL DEFAULT TRUE;

GRANT SELECT (reminders_enabled) ON parties TO anon, authenticated;

ALTER TABLE guests
  ADD COLUMN reminders_unsubscribed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN reminder_sent_at TIMESTAMPTZ;

GRANT SELECT (reminders_unsubscribed, reminder_sent_at)
  ON guests TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_guests_reminder_pending
  ON guests (party_id)
  WHERE reminder_sent_at IS NULL
    AND reminders_unsubscribed = FALSE
    AND approved = TRUE
    AND email IS NOT NULL;
```

**The migration is NOT applied as part of this PR.** Snax will apply via
`mcp__supabase-pizzadao__apply_migration` after review.

## Prisma — `backend/prisma/schema.prisma`

In `model Party` next to `turtleRolesEnabled`:

```prisma
remindersEnabled Boolean @default(true) @map("reminders_enabled")
```

In `model Guest` after the check-in block:

```prisma
remindersUnsubscribed Boolean   @default(false) @map("reminders_unsubscribed")
reminderSentAt        DateTime? @map("reminder_sent_at") @db.Timestamptz
```

`cd backend && npx prisma generate` after editing.

## Backend — new `backend/src/routes/reminder.routes.ts`

Two endpoints on one router (see file for full implementation):

1. `GET /api/cron/event-reminders` — see Design above.
2. `GET` and `POST /api/reminders/unsubscribe?g=<guestId>&s=<sig>`.

Email content mirrors `sendApprovalEmail` in `rsvp.routes.ts`:
- `from: 'RSV.Pizza <noreply@rsv.pizza>'`
- `#1a1a2e → #16213e` gradient header, `#ff393a` CTA, `#f9f9f9` card backgrounds
- Subject: `Tonight at ${time}: ${partyName} 🍕`
- Both `html` AND `text` parts
- `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click`

When formatting:
- Time format: `toLocaleDateString('en-US', { weekday, month, day, hour, minute, timeZone: party.timezone || undefined })`
- Event URL: `customUrl` if present else `inviteCode` → `https://rsv.pizza/{slug}`
- Address text: `venueName + ', ' + address` if both present, else whichever exists, else `'Location TBD'`

## Backend — `backend/src/index.ts`

Import + mount the router AFTER `app.use('/api/ens', ensRoutes)`:

```ts
import reminderRoutes from './routes/reminder.routes.js';
// ...
app.use('/api', reminderRoutes); // margherita-58471
```

## Backend — `backend/vercel.json`

Add a top-level `"crons"` array:

```json
"crons": [
  { "path": "/api/cron/event-reminders", "schedule": "*/15 * * * *" }
]
```

If the Vercel build rejects the cron schedule (free-tier limit), fall back to
pg_cron via:

```sql
SELECT cron.schedule(
  'event-reminders-t4h',
  '*/15 * * * *',
  $$ SELECT net.http_get(
    'https://api.rsv.pizza/api/cron/event-reminders',
    ARRAY[net.http_header('Authorization', 'Bearer ' || current_setting('app.cron_secret'))]
  ) $$
);
```

(Not applied pre-emptively.)

## Backend — `backend/src/routes/party.routes.ts` PATCH handler

Destructure `remindersEnabled` after `turtleRolesEnabled`, and conditional-spread
into the Prisma `data` block:

```ts
...(remindersEnabled !== undefined && { remindersEnabled }),
```

**The POST handler is intentionally NOT touched.** New events get the Prisma
`default(true)` — this sidesteps the historical POST/PATCH-asymmetry footgun
(see `calzone-71208` in MEMORY).

## Frontend wiring

The 7-place gotcha is observed:

| Layer | File | Change |
|---|---|---|
| Migration | `supabase/migrations/20260521_event_reminders.sql` | Add column + grants + partial index |
| Column-level SELECT grant | Same migration | `GRANT SELECT (…)` to anon + authenticated |
| Prisma schema | `backend/prisma/schema.prisma` | `remindersEnabled` on Party, two fields on Guest |
| Backend PATCH | `backend/src/routes/party.routes.ts` | Destructure + spread |
| `updateParty` field list | `frontend/src/lib/supabase.ts` | Add to `updates` param + forward to `updatePartyApi` |
| `dbPartyToParty` mapper | `frontend/src/contexts/PizzaContext.tsx` | `remindersEnabled: dbParty.reminders_enabled !== false` |
| `DbParty` interface | `frontend/src/lib/supabase.ts` | Add `reminders_enabled?: boolean` |

Plus:
- `frontend/src/lib/supabase.ts` `SAFE_PARTY_COLUMNS` — add `reminders_enabled`
- `frontend/src/lib/api.ts` — add to `UpdatePartyData` + body
- `frontend/src/types.ts` `Party` interface — add `remindersEnabled?: boolean`
- `frontend/src/components/EventDetailsTab.tsx` — state hook, init from party,
  Checkbox in optional-fields section. Label: "Send guests a reminder 4 hours
  before". No confirm modal (reversible).

## Deploy order

1. **Apply migration** to production via Supabase MCP.
2. **Set Vercel env vars** on the backend project (Production + Preview):
   - `CRON_SECRET` — long random string
   - `UNSUBSCRIBE_SECRET` — long random string
   - `BACKEND_PUBLIC_URL` — `https://api.rsv.pizza`
3. **Merge & deploy backend** from master.
4. **Verify Vercel cron registered** in the dashboard (project → Settings → Cron Jobs).
5. **Smoke-test cron**:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://api.rsv.pizza/api/cron/event-reminders
   # Expect: { "ok": true, "scanned": N, "sent": M, "failed": 0 }
   ```
6. **Smoke-test unsubscribe** for a known guest:
   ```sql
   -- in Supabase SQL editor: pick a test guest id
   SELECT id, email, reminders_unsubscribed FROM guests WHERE email = 'test@example.com';
   ```
   Then hit `https://api.rsv.pizza/api/reminders/unsubscribe?g=<id>&s=<sig>`
   (sig must be generated server-side with the same `UNSUBSCRIBE_SECRET`).
7. **Merge frontend**. Toggle visible in EventDetailsTab → optional fields.

## Out of scope (intentional)

- Multiple reminders (no 7d / 1h variants)
- Per-event custom offset
- Localization (English-only — confirmed)
- SMS
- Reminders for declined/pending/waitlisted guests
- Reminders to hosts/co-hosts as recipients (a host who's also a guest still gets one — fine)
- Calendar `.ics` attachments
- A reminders log table (`reminder_sent_at` is the audit trail)
- Re-subscribe UI
- Open/click tracking pixels
- Resend `/emails/batch`

## Risks / known unknowns

- **Vercel cron tier**: presumed Pro (team has 20+ projects). If the build
  rejects the schedule, fall back to pg_cron per the snippet above.
- **Email volume**: ~no risk in normal operation. Cap of 5 parallel sends per
  tick (15-min cadence) means we max out around 300/min sustained.
- **Long-window event**: if an event ends in <4h, all approved guests are
  already there and a reminder might feel weird. We don't currently check
  duration. Acceptable for v1.
