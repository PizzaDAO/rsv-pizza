# calabrese-58204 — Pool exhaustion / Realtime subscription scope fix (P0)

## Incident summary

2026-05-19 — site-wide 500s. Mitigated by a Supabase project restart + Micro
compute upgrade. Root cause investigation pointed at the realtime
`subscription` table: pg_stat_statements showed 174k inserts + 174k deletes
against `realtime.subscription` over a short window, with the WAL reader
pinned to 89.3% of total exec time. The connection pool starved, every
backend request 500'd.

## Root cause

`frontend/src/contexts/PizzaContext.tsx` had a `useEffect` that called
`db.subscribeToGuests(party.id, ...)` whenever a party was loaded into the
context. PizzaContext is mounted on **both HostPage and RSVPPage** — RSVPPage
is the public invitee-facing form, which means every invitee opening their
RSVP link opened a Supabase Realtime channel. Bulk invite blasts (hundreds of
emails fired at once) caused hundreds of simultaneous channel opens, each one
churning a row through `realtime.subscription`, which the WAL reader had to
process. The DB compute saturated and the connection pool ran out.

`guests` is the only app table in the `supabase_realtime` publication, so
this is a guest-subscription-only problem.

## Fix

Realtime subscription is now **opt-in per page**:

1. Removed the broad `useEffect` subscription from `PizzaContext.tsx`.
2. Added `frontend/src/hooks/useGuestsRealtime.ts` — opt-in hook host-side
   pages call to get live guest updates.
3. Exposed `setGuests` (aliased to `setAllGuests`) and `setParty` on the
   PizzaContext so the new hook can write into context state.
4. Wired the hook up on `HostPage.tsx`. Public pages (RSVPPage, EventPage,
   /partner, /map) intentionally do NOT subscribe.

## Defense-in-depth

- `/api/health` now includes a `SELECT 1` Prisma round-trip so external
  uptime monitors detect DB saturation instead of seeing a healthy app
  process sitting on a dead pool. Returns `dbMs` + `degraded: dbMs > 1000`.
- Prisma client now ships with `transactionOptions: { maxWait: 5000,
  timeout: 8000 }` so a stuck transaction can't hold a pool connection
  indefinitely.

## Things deliberately NOT changed

- `subscribeToGuests` in `frontend/src/lib/supabase.ts` — same signature,
  still in use by the new hook.
- Prisma schema — code-only fix.
- `DATABASE_URL` connection_limit — Snax handles deploy-time env var changes.

## Future-agent note

Do NOT re-introduce a global guest subscription in `PizzaContext`. Adding
realtime to a context that's mounted on public pages will reproduce the
outage. If a new host-side page needs live guest updates, call
`useGuestsRealtime(party?.id, onChange)` from that page.
