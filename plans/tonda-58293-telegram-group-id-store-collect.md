# tonda-58293 — Telegram city group chat IDs in the DB (Phase 1)

## Problem
City Telegram group chat IDs live ONLY in a Google Sheet
(`16T3_iXywToXQqxTyDIniWIA4SUI8Wj0a5LKHSAJL_9Q`, gid `811297100`, col 10 =
groupId), fetched client-side via `frontend/src/lib/telegram.ts`. The backend
has no copy. When a group is upgraded to a supergroup, Telegram returns a 400
with `parameters.migrate_to_chat_id`:

- The `/underboss` broadcast retries with the new id and succeeds, but only
  returns `"Migrated: update sheet to {newChatId}"` — it never persists.
- The receipts/wallet reminder endpoints have NO retry at all and read the
  chat id from a client-supplied `groupChatId`.

So the mapping silently drifts and reminders/broadcasts stop reaching migrated
groups.

## Phase 1 scope (this PR — code only)

1. **Schema** — new table `city_telegram_groups` (`CityTelegramGroup` model)
   keyed by `cityKey = lower(trim(city))`, with `chatId BigInt?`, `chatUrl`,
   `title`, `isSupergroup`, `source` (sheet|webhook|migration|manual),
   `lastVerifiedAt`. Migration SQL at
   `backend/prisma/migrations/tonda-58293-city-telegram-groups.sql`
   (CREATE TABLE IF NOT EXISTS + unique index on `city_key`).

2. **Import script** — `backend/scripts/import-telegram-groups.ts`. Fetches the
   sheet gviz JSON (col 5 city, col 8 chatUrl, col 10 groupId), keeps only
   groupIds matching `/^-?\d+$/`, upserts keyed by cityKey with `source='sheet'`,
   `isSupergroup = startsWith('-100')`. Idempotent, `--dry-run` supported.

3. **Shared helper** — `backend/src/services/cityTelegramGroup.ts` exports
   `sendToCityGroup(cityKey, text, parseMode?)`. Looks up the row; skips when no
   row / null chatId; sends via the bot; on `migrate_to_chat_id` retries once and
   persists the new id (`source='migration'`, `isSupergroup=true`); touches
   `lastVerifiedAt` on success. Returns `{ ok, skipped?, reason?, chatId, migratedTo? }`.

4. **Persist migrations in both paths**
   - `telegram.routes.ts` `/broadcast`: after a successful migration retry, upsert
     the new id into `city_telegram_groups` for that city; message now notes it's
     saved automatically.
   - `admin-payout.routes.ts` `tg-receipts-reminder` + `tg-wallet-reminder`: the
     GROUP channel now goes through `sendToCityGroup(cityKeyFromPartyName(name))`,
     adding the migration retry+persist these endpoints lacked. Host-DM channel
     unchanged.

5. **DB-first read endpoint** — `GET /api/underboss/telegram/groups`
   (requireAuth + requireUnderbossAuth). Returns `city_telegram_groups` rows
   scoped to the caller's cities (admin/region-only UB = all), chatId serialized
   to string. Scoping pushed into the Prisma `where`.

6. **Frontend → DB** — `TelegramBroadcast.tsx` and the payouts reminder UI read
   from the new endpoint (`fetchCityTelegramGroups()` in `api.ts`) instead of the
   sheet. Reminder calls no longer pass `groupChatId` (backend resolves it);
   removed the `cityGroupChatIds` map/state/prop from `PaymentsAdminPage` +
   `PayoutsByPartyTable`. `frontend/src/lib/telegram.ts` is left in place as
   legacy/import-only.

## Out of scope (later phases)
- Webhook-driven capture of migrations / new groups (`source='webhook'`).
- Admin UI to edit/add city groups directly.

## Post-merge ops (main session)
1. Apply `backend/prisma/migrations/tonda-58293-city-telegram-groups.sql` to prod
   (Supabase MCP or pg + DATABASE_URL — this repo has no migration auto-apply).
2. Run `backend/scripts/import-telegram-groups.ts` with DATABASE_URL to seed the
   table from the sheet. Until both run, the preview shows an empty group list.
