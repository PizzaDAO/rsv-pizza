# tonda-58293 Phase 2 — auto-capture Telegram group chat IDs + /underboss gap report

Stacks on Phase 1 (`tonda-58293-tg-group-ids`, PR #818). Branch: `tonda-58293-tg-collect-p2`,
draft PR base = `tonda-58293-tg-group-ids`.

## Goal
The bot can only learn a group's `chat_id` from an update it receives. Auto-capture those
ids via the webhook, auto-match them to known cities, and give /underboss a gap report so
admins/UBs can see which cities still lack a group + assign orphan captures.

## What Phase 1 provides (base branch)
- `CityTelegramGroup` / `city_telegram_groups` (city_key, chat_id BigInt, …) — live in prod.
- `sendToCityGroup(cityKey, text, parseMode?)` in `backend/src/services/cityTelegramGroup.ts`.
- `GET /api/underboss/telegram/groups` in `telegram.routes.ts` (mounted `/api/underboss/telegram`).
- `cityKeyFromPartyName(name)` in `backend/src/helpers/underbossScope.ts` (lower(trim(city))).
- Webhook at `telegram-webhook.routes.ts` (mounted `/api/telegram/webhook`) — handled only
  private-DM `/start` `/disconnect` and ignored everything else.

## Telegram mechanics
- `my_chat_member` fires when the bot is added/promoted regardless of privacy mode → AUTOMATIC
  capture path (new groups).
- chat.type = group | supergroup; supergroup ids are big negatives (-100…) → BigInt.

## Rework (post-#821): discrete/manual capture, not passive
The bot (@MoltoBeneBot) has privacy mode OFF and sits in ~466+ groups, so the original
"upsert on every group message" path was a needless write firehose. A group's chat_id is
immutable except on supergroup migration (already auto-handled on send via
`migrate_to_chat_id` in `sendToCityGroup`). Capture is therefore limited to discrete events:

1. **my_chat_member (automatic)** — bot added/promoted to a group/supergroup → capture.
   Unchanged.
2. **/register command (manual)** — `message.text` in a group is `/register` or
   `/register@<botusername>` (case-insensitive; first token, strip `@mention` suffix). On the
   command: run `captureTelegramGroup`, then reply in the group confirming
   (auto-matched → "✅ Captured this group for {city} …"; else → "✅ Got it … assign it in
   /underboss"). Non-command group messages are IGNORED (no upsert), just 200.
3. **Refresh button (on-demand getChat)** — `POST /groups/:cityKey/refresh` for a city that
   ALREADY has a chat_id: call `getChat(chatId)`, update title / is_supergroup /
   last_verified_at; persist the new id + is_supergroup=true if the chat migrated (mirrors
   `sendToCityGroup` migration persistence). 400 if the city has no chat_id on file.

Passive every-message capture is REMOVED. The bot's privacy mode can later be set ON via
BotFather; re-adding the bot to a group both applies the new privacy setting AND fires a fresh
`my_chat_member` (so the automatic capture path still works after the privacy flip).

## 1. Schema — new table `telegram_group_captures`
Prisma model `TelegramGroupCapture` `@@map("telegram_group_captures")`: id Uuid, chatId BigInt
@unique, title?, chatType?, assignedCityKey? (null = pending), autoMatched bool, firstSeenAt,
lastSeenAt. Migration SQL at `backend/prisma/migrations/tonda-58293-telegram-group-captures.sql`
(CREATE TABLE IF NOT EXISTS + unique index; comments on own lines). `git add -f` (gitignored).
NOT applied — main session applies to prod.

## 2. Webhook capture (`telegram-webhook.routes.ts`)
KEEP private-DM logic untouched. Two discrete group-capture branches BEFORE the ignore
fallthrough (group updates never fall into the private-DM path):
  - `my_chat_member` chat is group/supergroup → capture (automatic).
  - group/supergroup `message.text` whose first token (sans `@mention`, case-insensitive) is
    `/register` → capture + reply in the group with a confirmation. Non-command group messages
    are ignored (no upsert), return 200.
Capture = `captureTelegramGroup()` service: upsert `telegram_group_captures` by chat_id;
auto-match candidate cityKeys = [cityKeyFromPartyName(title), title.toLowerCase().trim()]
against "known" cities; if matched stamp assignedCityKey+autoMatched AND write-through
`city_telegram_groups` (source='webhook'). Always 200.

"Known city" = exists in city_telegram_groups.city_key OR == cityKeyFromPartyName of a
non-cancelled GPP party OR exists in city_statuses.city_key.

## 3. Endpoints (`telegram.routes.ts`, same auth + scope as GET /groups)
- `GET /groups/status`: universe = distinct cityKeyFromPartyName over non-cancelled GPP parties
  (scope pushed into Prisma where), LEFT JOIN city_telegram_groups; + pendingCaptures
  (assignedCityKey IS NULL). Scope: admin=all, region-UB=regions, city-UB=cities.
- `POST /groups/assign` {chatId, cityKey}: stamp capture + upsert city_telegram_groups
  (source='manual'). Validate cityKey non-empty + callerOwnsCity scope check.
- `POST /groups/:cityKey/test`: sendToCityGroup(...) test message. Scope-check the city.
- `POST /groups/:cityKey/refresh`: for a city with an existing chat_id, getChat(chatId) →
  update title / is_supergroup / last_verified_at; persist migrated id + is_supergroup=true on
  migration. 400 if no chat_id on file. Scope-check the city. Returns the updated row.
- All BigInt serialized to string.

## 4. Frontend — new "Telegram Groups" tab (`UnderbossDashboard.tsx`)
Add `'telegram-groups'` to activeTab union + tab button + content block → `TelegramGroupsTab`
(new component in `frontend/src/components/underboss/`, exported from index.ts). Tab shows gap
report table (status badge ✅/⚠️/❌, region filter, missing-first sort, per-city Refresh + Test)
+ pending captures with city `<select>` + Assign. Refresh button per city that HAS an id calls
`POST /groups/:cityKey/refresh` and shows the result inline. Helper text: "To add a missing
city: add @MoltoBeneBot to its Telegram group, or post /register in the group — the ID is
captured automatically." api.ts: fetchTelegramGroupsStatus, assignTelegramGroup,
testCityTelegramGroup, refreshCityTelegramGroup (chatIds as strings).

## Finish
- backend + frontend `npx tsc --noEmit` clean (ignore pre-existing ens.service / auth.test).
- Draft PR base = `tonda-58293-tg-group-ids`.
- Main session must: (a) apply the migration SQL to prod, (b) re-register the Telegram webhook
  with `allowed_updates` including `my_chat_member`.
