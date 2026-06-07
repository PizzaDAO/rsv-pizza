/**
 * provola-58505 (Step 2): one-way sync of city → Telegram group chat_ids from
 * the moltobene service into `city_telegram_groups`.
 *
 * moltobene is the new authoritative owner of the Telegram bot's group
 * membership. It exposes `GET /city/groups` returning the groups it knows about.
 * We pull that list and reconcile it into `city_telegram_groups` so the existing
 * `sendToCityGroup(cityKey)` consumer (and the /underboss Groups tab) keep
 * working against fresh chat_ids.
 *
 * Identity is the Telegram `chat_id`, NOT the cityKey:
 *   - chat_id is immutable for the life of a group (modulo supergroup migration,
 *     which moltobene handles on its side and re-reports as a new -100… id).
 *   - cityKey is a derived label that can move between groups.
 * So we first try to find an existing row by chat_id and update it in place
 * (even if its cityKey differs — a group was renamed/re-keyed). Only when no row
 * holds that chat_id do we upsert by cityKey. If a DIFFERENT existing row
 * already holds the target cityKey with a DIFFERENT chat_id, we log a collision
 * and skip rather than clobber — a human should resolve which group is canonical.
 *
 * IMPORTANT: `region` is stored as the GPP region SLUG (e.g. `western-europe`)
 * resolved from our own GPP parties via `getGppRegionByCityKey`, NOT moltobene's
 * free-text `regionName`. The region column drives slug-based UB scoping in
 * GET /groups and friends; storing a display name there would silently break it.
 *
 * Never throws on a config gap — returns `{ ok:false, reason }` so the cron and
 * admin endpoints can degrade gracefully.
 */
import { prisma } from '../config/database.js';
import { getGppRegionByCityKey } from '../helpers/underbossScope.js';

interface MoltobeneCity {
  cityName?: unknown;
  countryName?: unknown;
  regionName?: unknown;
  groupId?: unknown;
  telegramLink?: unknown;
}

interface MoltobeneGroupsResponse {
  cities?: MoltobeneCity[];
}

export interface MoltobeneSyncCollision {
  cityKey: string;
  /** chat_id moltobene reported for this cityKey. */
  incomingChatId: string;
  /** chat_id already stored on the existing row for this cityKey. */
  existingChatId: string;
}

export interface MoltobeneSyncResult {
  ok: boolean;
  reason?: string;
  /** Number of city records received from moltobene. */
  fetched?: number;
  /** Rows created or updated (by chat_id match OR cityKey upsert). */
  upserted?: number;
  /** Of `upserted`, how many were matched by chat_id (vs cityKey upsert). */
  matchedByChatId?: number;
  /** cityKey conflicts that were skipped (different existing chat_id). */
  collisions?: MoltobeneSyncCollision[];
  /** Records whose groupId was not a valid integer string. */
  invalidGroupId?: number;
  /** Records skipped for any reason (missing cityName, collision, invalid). */
  skipped?: number;
}

/** Validate that a value is a base-10 integer string Telegram chat_ids use. */
function parseGroupId(groupId: unknown): bigint | null {
  if (typeof groupId !== 'string' && typeof groupId !== 'number') return null;
  const str = `${groupId}`.trim();
  // Telegram group ids are negative integers (often -100…); accept any integer.
  if (!/^-?\d+$/.test(str)) return null;
  try {
    return BigInt(str);
  } catch {
    return null;
  }
}

export async function syncCityGroupsFromMoltobene(): Promise<MoltobeneSyncResult> {
  const baseUrl = process.env.MOLTOBENE_BASE_URL;
  const apiKey = process.env.MOLTOBENE_API_KEY;
  if (!baseUrl || !apiKey) {
    return { ok: false, reason: 'moltobene sync not configured' };
  }

  let payload: MoltobeneGroupsResponse;
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/city/groups`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });
    if (!resp.ok) {
      return { ok: false, reason: `moltobene responded ${resp.status}` };
    }
    payload = (await resp.json()) as MoltobeneGroupsResponse;
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'moltobene fetch failed' };
  }

  const cities = Array.isArray(payload?.cities) ? payload.cities : [];

  let upserted = 0;
  let matchedByChatId = 0;
  let invalidGroupId = 0;
  let skipped = 0;
  const collisions: MoltobeneSyncCollision[] = [];

  for (const c of cities) {
    const cityName = typeof c.cityName === 'string' ? c.cityName : '';
    const cityKey = cityName.toLowerCase().trim();
    if (!cityKey) {
      skipped++;
      continue;
    }

    const chatIdBig = parseGroupId(c.groupId);
    if (chatIdBig === null) {
      invalidGroupId++;
      skipped++;
      continue;
    }

    const groupIdStr = `${c.groupId}`.trim();
    const isSupergroup = groupIdStr.startsWith('-100');
    const chatUrl = typeof c.telegramLink === 'string' ? c.telegramLink : null;
    const country = typeof c.countryName === 'string' ? c.countryName : null;
    // region = GPP region SLUG resolved from our own parties — NOT moltobene's
    // display regionName.
    const region = await getGppRegionByCityKey(cityKey);

    const writeData = {
      chatId: chatIdBig,
      chatUrl,
      country,
      isSupergroup,
      source: 'moltobene-sync',
      // Only write region when we resolved one — never clobber an existing slug
      // with null.
      ...(region ? { region } : {}),
      lastVerifiedAt: new Date(),
    };

    try {
      // 1. Identity match: an existing row already holding this chat_id.
      const byChatId = await prisma.cityTelegramGroup.findFirst({
        where: { chatId: chatIdBig },
        select: { id: true },
      });

      if (byChatId) {
        await prisma.cityTelegramGroup.update({
          where: { id: byChatId.id },
          data: writeData,
        });
        upserted++;
        matchedByChatId++;
        continue;
      }

      // 2. No row owns this chat_id. Check whether the target cityKey is taken
      //    by a DIFFERENT chat_id — if so, collision, don't clobber.
      const byCityKey = await prisma.cityTelegramGroup.findUnique({
        where: { cityKey },
        select: { chatId: true },
      });

      if (byCityKey && byCityKey.chatId !== null && byCityKey.chatId !== chatIdBig) {
        collisions.push({
          cityKey,
          incomingChatId: chatIdBig.toString(),
          existingChatId: byCityKey.chatId.toString(),
        });
        skipped++;
        console.warn(
          `[provola-58505][moltobene-sync] cityKey collision for "${cityKey}": ` +
            `incoming chat_id ${chatIdBig} != existing ${byCityKey.chatId} — skipping.`,
        );
        continue;
      }

      // 3. Safe to upsert by cityKey (row absent, or present with null/same id).
      await prisma.cityTelegramGroup.upsert({
        where: { cityKey },
        create: { cityKey, ...writeData },
        update: writeData,
      });
      upserted++;
    } catch (err: any) {
      skipped++;
      console.error(
        `[provola-58505][moltobene-sync] failed to write "${cityKey}":`,
        err?.message || err,
      );
    }
  }

  return {
    ok: true,
    fetched: cities.length,
    upserted,
    matchedByChatId,
    collisions,
    invalidGroupId,
    skipped,
  };
}

/**
 * provola-58505 (lazy on-demand sync): refresh ONE city's group from moltobene.
 *
 * The scheduled bulk sync was retired in favour of a lazy, per-city pull driven
 * by `sendToCityGroup`: when a city's `city_telegram_groups` row is missing/has
 * a null chat_id, OR a send fails with a chat-not-found error, we call this once
 * to ask moltobene (the authoritative owner of the bot's group membership) for
 * that city's current chat_id, upsert it, and let the caller retry the send.
 *
 * Best-effort by contract — NEVER throws:
 *   - `MOLTOBENE_BASE_URL`/`MOLTOBENE_API_KEY` unset → return null.
 *   - moltobene unreachable / non-2xx / city not present → return null.
 *   - on success → upsert the row (chatId, chatUrl, country, isSupergroup,
 *     source='moltobene-sync', region via getGppRegionByCityKey,
 *     lastVerifiedAt=now()) and return the chatId as a bigint.
 *
 * Returns the resolved chat_id so the caller can retry without a re-read.
 */
export async function refreshCityGroupFromMoltobene(
  cityKey: string,
): Promise<bigint | null> {
  const key = (cityKey || '').toLowerCase().trim();
  if (!key) return null;

  const baseUrl = process.env.MOLTOBENE_BASE_URL;
  const apiKey = process.env.MOLTOBENE_API_KEY;
  if (!baseUrl || !apiKey) {
    // Config gap → graceful no-op (matches the bulk sync's degrade behavior).
    return null;
  }

  let payload: MoltobeneGroupsResponse;
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/city/groups`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });
    if (!resp.ok) {
      console.warn(
        `[provola-58505][moltobene-refresh] moltobene responded ${resp.status} for "${key}"`,
      );
      return null;
    }
    payload = (await resp.json()) as MoltobeneGroupsResponse;
  } catch (err: any) {
    console.warn(
      `[provola-58505][moltobene-refresh] fetch failed for "${key}":`,
      err?.message || err,
    );
    return null;
  }

  const cities = Array.isArray(payload?.cities) ? payload.cities : [];
  // Find the city whose normalized name matches the requested key.
  const match = cities.find((c) => {
    const name = typeof c.cityName === 'string' ? c.cityName : '';
    return name.toLowerCase().trim() === key;
  });
  if (!match) return null;

  const chatIdBig = parseGroupId(match.groupId);
  if (chatIdBig === null) return null;

  const groupIdStr = `${match.groupId}`.trim();
  const isSupergroup = groupIdStr.startsWith('-100');
  const chatUrl = typeof match.telegramLink === 'string' ? match.telegramLink : null;
  const country = typeof match.countryName === 'string' ? match.countryName : null;
  // region = GPP region SLUG resolved from our own parties — NOT moltobene's
  // display regionName.
  const region = await getGppRegionByCityKey(key);

  const writeData = {
    chatId: chatIdBig,
    chatUrl,
    country,
    isSupergroup,
    source: 'moltobene-sync',
    // Only write region when we resolved one — never clobber an existing slug.
    ...(region ? { region } : {}),
    lastVerifiedAt: new Date(),
  };

  try {
    await prisma.cityTelegramGroup.upsert({
      where: { cityKey: key },
      create: { cityKey: key, ...writeData },
      update: writeData,
    });
  } catch (err: any) {
    console.error(
      `[provola-58505][moltobene-refresh] failed to upsert "${key}":`,
      err?.message || err,
    );
    return null;
  }

  return chatIdBig;
}
