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
- `my_chat_member` fires when the bot is added/promoted regardless of privacy mode → PRIMARY
  capture path. Group messages only arrive when privacy is off or it's a command/mention/reply
  → bonus path.
- chat.type = group | supergroup; supergroup ids are big negatives (-100…) → BigInt.

## 1. Schema — new table `telegram_group_captures`
Prisma model `TelegramGroupCapture` `@@map("telegram_group_captures")`: id Uuid, chatId BigInt
@unique, title?, chatType?, assignedCityKey? (null = pending), autoMatched bool, firstSeenAt,
lastSeenAt. Migration SQL at `backend/prisma/migrations/tonda-58293-telegram-group-captures.sql`
(CREATE TABLE IF NOT EXISTS + unique index; comments on own lines). `git add -f` (gitignored).
NOT applied — main session applies to prod.

## 2. Webhook capture (`telegram-webhook.routes.ts`)
KEEP private-DM logic. ADD before the ignore fallthrough: if `my_chat_member` chat is
group/supergroup → capture; else if `message` chat is group/supergroup → capture. Capture =
`captureTelegramGroup()` service: upsert `telegram_group_captures` by chat_id; auto-match
candidate cityKeys = [cityKeyFromPartyName(title), title.toLowerCase().trim()] against
"known" cities; if matched stamp assignedCityKey+autoMatched AND write-through
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
- All BigInt serialized to string.

## 4. Frontend — new "Telegram Groups" tab (`UnderbossDashboard.tsx`)
Add `'telegram-groups'` to activeTab union + tab button + content block → `TelegramGroupsTab`
(new component in `frontend/src/components/underboss/`, exported from index.ts). Tab shows gap
report table (status badge ✅/⚠️/❌, region filter, missing-first sort, per-city Test) + pending
captures with city `<select>` + Assign. api.ts: fetchTelegramGroupsStatus, assignTelegramGroup,
testCityTelegramGroup (chatIds as strings).

## Finish
- backend + frontend `npx tsc --noEmit` clean (ignore pre-existing ens.service / auth.test).
- Draft PR base = `tonda-58293-tg-group-ids`.
- Main session must: (a) apply the migration SQL to prod, (b) re-register the Telegram webhook
  with `allowed_updates` including `my_chat_member`.
