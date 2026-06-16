# panforte-58533 — Host-connect recency in submitter resolution

## Bug
In `backend/src/services/hostInboundResolve.ts`, `resolveSubmitterContext` ranks
all candidate parties for a Telegram chatId by "most recent action wins".
Contributor candidates use their own row's `updatedAt`, but HOST candidates
computed recency from `maxReminder(p) ?? eventDate` and **ignored the
`party_telegram_hosts` row's `updatedAt`** (the actual connect time). So a host
who just connected could lose to a stale contributor row for a different event
and get their receipt/headcount rejected.

## Repro
Chat `706681092` connected as host of **Philadelphia** today, but its `100`
headcount resolved to **Moscow** (a 4-day-old contributor row) and was rejected.

## Fix
Two small edits, both inside `resolveSubmitterContext`:
1. Add `updatedAt: true` to the host `partyTelegramHost.findMany` `select`.
2. Fold the host-link connect time into host recency:
   `Math.max(row.updatedAt, maxReminder(p) ?? eventDate)` — symmetric with how
   contributor recency already uses its own `row.updatedAt`.

No DB migration (`party_telegram_hosts.updatedAt` already exists). Did not touch
`resolveHostPartyByChatId`, the contributor loop, or the tie-break.
