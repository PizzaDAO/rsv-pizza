# crostata-58533 — Verify editor co-hosts as hosts in `link-host`

A suppli-58533 follow-up. Backend-only (rsvpizza), no migration.

## Problem

`POST /api/telegram/link-host` (`backend/src/routes/telegram-link-callback.routes.ts`)
verified the tapper's Telegram @handle ONLY against the party's **primary** host
(`party.user.telegram`). Co-hosts — stored in `parties.co_hosts` JSON (Prisma
field `coHosts`) — were never considered, so an editor co-host who tapped the
connect link was wrongly downgraded to a photo-only contributor and couldn't
submit receipts/attendance via DM.

Confirmed live: Philadelphia primary host is `Saucysaucier`, but editor co-host
`@snack_man` got bounced to contributor.

## Fix

In the `link-host` handler:

1. Add `coHosts: true` to the party `select`.
2. Build a set of authorized host handles = primary host telegram + every
   co-host with `canEdit === true` and a string `telegram` field. Only the
   `telegram` field is matched — display-only partners have `canEdit:false` and
   no telegram, so they're excluded (twitter/instagram are never matched).
   Match the normalized tapper handle against that set.
3. On a host match, also `deleteMany` any stale `party_telegram_contributors`
   row for this `(partyId, chatId)` so it can't shadow the host binding in
   `resolveSubmitterContext` ("most-recent-action-wins").

The contributor (`linkPurpose === 'submit'`) and `not_host` branches are
unchanged. `normalizeTgHandle` is unchanged.

## Scope

- rsvpizza only, single file: `backend/src/routes/telegram-link-callback.routes.ts`.
- No migration (reads existing `co_hosts` JSON; deletes existing contributor rows).
- Backend auto-deploys from `master` on merge.

## Test plan

After deploy: an editor co-host taps the connect link / pastes
`/start submit_<token>` → bot replies "connected as host" → their
headcount/receipt is attributed to the event.
