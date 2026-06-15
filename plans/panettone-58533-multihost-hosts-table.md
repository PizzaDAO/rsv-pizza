# panettone-58533 — Multi-host Telegram submission auth (`party_telegram_hosts`)

Follow-up to suppli-58533 (host DM submissions to Molto Benny).

## Problem
Inbound host submission auth keyed off the single `parties.host_telegram_chat_id`
column. That's one slot per party — last-writer-wins. When two co-hosts each
tapped the connect link, the second overwrote the first, so only one co-host
could ever submit a receipt/photo/headcount via Telegram. The other silently
fell through to "no party matches this chat".

## Scope (decided)
- New `party_telegram_hosts` table is the auth source for **INBOUND** submissions
  only (one row per verified host chat, many per party).
- `host_telegram_chat_id` **STAYS** as the single primary **OUTBOUND** DM target
  (reminders / notifications / coverage). No outbound/reminder code touched.

## The table (ALREADY applied + backfilled in prod via MCP, 2026-06-15)
```sql
CREATE TABLE party_telegram_hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  chat_id bigint NOT NULL,
  telegram_user_id bigint,
  username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, chat_id)
);
CREATE INDEX party_telegram_hosts_chat_id_idx ON party_telegram_hosts (chat_id);
```
8 existing host bindings were backfilled from `host_telegram_chat_id`. No
migration runs on merge — `supabase/migrations/20260615_create_party_telegram_hosts.sql`
exists only for repo record + the schema drift guard (uses `IF NOT EXISTS`).

## Code touch-points (4)
1. **`backend/prisma/schema.prisma`** — new `PartyTelegramHost` model mirroring
   `PartyTelegramContributor`, plus `telegramHosts PartyTelegramHost[]`
   back-relation on `Party`.
2. **`backend/src/routes/telegram-link-callback.routes.ts`** (`POST /link-host`) —
   `telegramUserId`→`tgUserId` BigInt parse hoisted above the `isHost` branch so
   both branches share it. The `isHost` branch now **upserts** the host chat into
   `party_telegram_hosts` (the inbound auth source), still sets
   `host_telegram_chat_id` (the outbound slot), and still clears a stale
   contributor row.
3. **`backend/src/services/hostInboundResolve.ts`** — both `resolveHostPartyByChatId`
   and `resolveSubmitterContext` now source host candidates from
   `party_telegram_hosts WHERE chat_id = chatId` (joined to the party) instead of
   `parties WHERE host_telegram_chat_id = chatId`. All recency / ambiguity /
   approved-fallback logic unchanged.
4. **`backend/src/routes/host-telegram.routes.ts`** (`DELETE /:partyId/host-telegram`) —
   disconnect now also `deleteMany`s the party's `party_telegram_hosts` rows so it
   genuinely revokes inbound submission auth (not just the outbound slot).

## Follow-up (out of scope)
The auto-unlink-on-failed-send sites in `backend/src/routes/telegram.routes.ts`
null `host_telegram_chat_id` when a DM bounces. They do **not** clear
`party_telegram_hosts` rows. A bounced outbound DM doesn't necessarily mean the
inbound binding is invalid, so this was intentionally left alone; revisit if we
want failed sends to also revoke inbound.
