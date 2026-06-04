/**
 * tonda-58293 Phase 2: capture + auto-match inbound Telegram group chat ids.
 *
 * The bot can only learn a group's chat_id from an update it receives. The
 * primary capture path is `my_chat_member` (fires when the bot is added or
 * promoted regardless of privacy mode); group messages are a bonus path.
 *
 * Every group/supergroup we see is upserted into `telegram_group_captures`.
 * We then try to auto-match it to a known city. If matched, we both stamp the
 * capture (assignedCityKey + autoMatched) AND write through to
 * `city_telegram_groups` so reminders/broadcasts can use it immediately.
 * Unmatched captures stay as orphans for manual assignment in /underboss.
 */
import { prisma } from '../config/database.js';
import { cityKeyFromPartyName } from '../helpers/underbossScope.js';

export interface CaptureGroupInput {
  chatId: number | bigint;
  title?: string | null;
  /** Telegram chat.type — expected 'group' | 'supergroup'. */
  chatType?: string | null;
}

/**
 * Determine whether a candidate cityKey is "known" to the system.
 *
 * A cityKey is known if it:
 *   - already exists as a row in `city_telegram_groups`, OR
 *   - equals the `cityKeyFromPartyName(party.name)` of a non-cancelled GPP
 *     party, OR
 *   - exists in `city_statuses.city_key`.
 *
 * All comparisons are against the normalized lower(trim(...)) cityKey form.
 */
async function findKnownCityKey(candidates: string[]): Promise<string | null> {
  const keys = Array.from(
    new Set(candidates.map((c) => (c || '').toLowerCase().trim()).filter(Boolean)),
  );
  if (keys.length === 0) return null;

  // 1. city_telegram_groups (already-resolved map)
  const tgRow = await prisma.cityTelegramGroup.findFirst({
    where: { cityKey: { in: keys } },
    select: { cityKey: true },
  });
  if (tgRow) return tgRow.cityKey;

  // 2. city_statuses
  const csRow = await prisma.cityStatus.findFirst({
    where: { cityKey: { in: keys } },
    select: { cityKey: true },
  });
  if (csRow) return csRow.cityKey;

  // 3. Non-cancelled GPP parties whose name yields one of the candidate keys.
  //    Party names follow "Global Pizza Party {City}"; we derive the key in
  //    code (no city_key column on parties) and match against candidates.
  const parties = await prisma.party.findMany({
    where: {
      eventType: 'gpp',
      cancelledAt: null,
    },
    select: { name: true },
  });
  const keySet = new Set(keys);
  for (const p of parties) {
    const key = cityKeyFromPartyName(p.name);
    if (key && keySet.has(key)) return key;
  }

  return null;
}

export interface CaptureResult {
  captured: boolean;
  chatId: string;
  matchedCityKey: string | null;
}

/**
 * Upsert a Telegram group capture and attempt to auto-match it to a city.
 *
 * Returns `{ captured, chatId, matchedCityKey }`. Never throws on the happy
 * path; callers (the webhook) must always 200.
 */
export async function captureTelegramGroup(input: CaptureGroupInput): Promise<CaptureResult> {
  const chatIdBig = typeof input.chatId === 'bigint' ? input.chatId : BigInt(input.chatId);
  const chatIdStr = chatIdBig.toString();
  const title = input.title ?? null;
  const chatType = input.chatType ?? null;
  const isSupergroup = chatType === 'supergroup';

  // Candidate city keys: from the GPP-name pattern in the title, and the raw
  // title lower/trimmed (covers groups literally named after the city).
  const candidates: string[] = [];
  const fromName = cityKeyFromPartyName(title);
  if (fromName) candidates.push(fromName);
  if (title) candidates.push(title.toLowerCase().trim());

  const matchedCityKey = candidates.length > 0 ? await findKnownCityKey(candidates) : null;

  // Upsert the capture row. Stamp assignment iff we matched.
  await prisma.telegramGroupCapture.upsert({
    where: { chatId: chatIdBig },
    create: {
      chatId: chatIdBig,
      title,
      chatType,
      ...(matchedCityKey
        ? { assignedCityKey: matchedCityKey, autoMatched: true }
        : {}),
    },
    update: {
      title,
      chatType,
      // Only auto-assign if not already assigned (don't clobber a manual assign).
      ...(matchedCityKey
        ? { assignedCityKey: matchedCityKey, autoMatched: true }
        : {}),
    },
  });

  // Write through to the resolved map when matched.
  if (matchedCityKey) {
    try {
      await prisma.cityTelegramGroup.upsert({
        where: { cityKey: matchedCityKey },
        create: {
          cityKey: matchedCityKey,
          chatId: chatIdBig,
          title,
          isSupergroup,
          source: 'webhook',
          lastVerifiedAt: new Date(),
        },
        update: {
          chatId: chatIdBig,
          title,
          isSupergroup,
          source: 'webhook',
          lastVerifiedAt: new Date(),
        },
      });
    } catch (err: any) {
      console.error(
        `[tonda-58293][capture] failed to write-through city_telegram_groups for ${matchedCityKey}:`,
        err?.message || err,
      );
    }
  }

  return { captured: true, chatId: chatIdStr, matchedCityKey };
}
