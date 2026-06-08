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
import {
  getGppRegionByCityKey,
  cityKeyFromPartyName,
  canonicalCityName,
} from '../helpers/underbossScope.js';

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
  /**
   * provola-58507: of the rows written, how many had their target cityKey
   * recovered via normalized-core name matching (bucket C) rather than the raw
   * lower(trim(cityName)) key.
   */
  matchedByNormalized?: number;
  /** cityKey conflicts that were skipped (different existing chat_id). */
  collisions?: MoltobeneSyncCollision[];
  /** Records whose groupId was not a valid integer string. */
  invalidGroupId?: number;
  /** Records skipped for any reason (missing cityName, collision, invalid). */
  skipped?: number;
}

/**
 * provola-58507: the canonical cityKey for a GPP party, mirroring the
 * `sendToCityGroup` caller in admin-payout.routes.ts:
 *   cityKeyFromPartyName(name) ?? name.toLowerCase().trim()
 * The first form is for canonical "Global Pizza Party {City}" names; the raw
 * fallback covers messy names ("portland, or", "quito global pizza party").
 * This MUST match what the sender uses, or a filled chat_id is never read.
 */
function canonicalCityKey(name: string | null | undefined): string {
  const derived = cityKeyFromPartyName(name);
  if (derived) return derived;
  return (name ?? '').toLowerCase().trim();
}

/**
 * provola-58507: a missing approved GPP city — one whose canonical cityKey has
 * NO row in city_telegram_groups, or a row with a NULL chatId.
 */
export interface MissingApprovedCity {
  cityKey: string;
  /** canonicalCityName(cityKey) — the comparable core used for matching. */
  normalized: string;
}

/**
 * provola-58507: build the set of approved GPP cities that still LACK a
 * resolvable Telegram chat_id, plus a `normalizedCore -> cityKey` index for
 * exact-equality matching against moltobene titles/cityNames.
 *
 * Approval gate pushed into Prisma (NO post-query JS filter on the party set):
 *   eventType='gpp', cancelledAt IS NULL, underbossStatus='approved'.
 *
 * "Missing" = the canonical cityKey has no city_telegram_groups row OR that
 * row's chatId is null. We read the groups table once and diff in memory
 * (the groups table is small — one row per known city).
 *
 * When two distinct cityKeys normalize to the SAME core (e.g. a real
 * collision), the core is marked AMBIGUOUS and excluded from the index — we
 * never auto-fill an ambiguous core (would risk the wrong group). Such cores
 * are returned in `ambiguousNormalized` for reporting.
 */
export async function buildMissingApprovedCityIndex(): Promise<{
  missing: MissingApprovedCity[];
  /** normalizedCore -> cityKey, ambiguous cores removed. */
  byNormalized: Map<string, string>;
  /** normalized cores that >1 missing cityKey share (excluded from byNormalized). */
  ambiguousNormalized: string[];
}> {
  // Approved, non-cancelled GPP parties — gate in the DB, not in JS.
  const parties = await prisma.party.findMany({
    where: {
      eventType: 'gpp',
      cancelledAt: null,
      underbossStatus: 'approved',
    },
    select: { name: true },
  });

  // Distinct canonical cityKeys of approved cities.
  const approvedKeys = new Set<string>();
  for (const p of parties) {
    const key = canonicalCityKey(p.name);
    if (key) approvedKeys.add(key);
  }

  // Which of those already have a resolvable chat_id?
  const groups = await prisma.cityTelegramGroup.findMany({
    select: { cityKey: true, chatId: true },
  });
  const resolved = new Set<string>();
  for (const g of groups) {
    if (g.chatId !== null) resolved.add(g.cityKey);
  }

  const missing: MissingApprovedCity[] = [];
  // normalizedCore -> Set<cityKey> so we can detect ambiguity.
  const coreToKeys = new Map<string, Set<string>>();
  for (const cityKey of approvedKeys) {
    if (resolved.has(cityKey)) continue;
    // provola-58509: canonicalize through the exonym alias map so a captured
    // group's LOCAL name ("Göteborg") resolves to the same core as the approved
    // ENGLISH city ("Gothenburg").
    const normalized = canonicalCityName(cityKey);
    missing.push({ cityKey, normalized });
    if (!normalized) continue; // empty core is never indexable.
    const set = coreToKeys.get(normalized) ?? new Set<string>();
    set.add(cityKey);
    coreToKeys.set(normalized, set);
  }

  const byNormalized = new Map<string, string>();
  const ambiguousNormalized: string[] = [];
  for (const [core, keys] of coreToKeys) {
    if (keys.size === 1) {
      byNormalized.set(core, [...keys][0]);
    } else {
      ambiguousNormalized.push(core);
    }
  }

  return { missing, byNormalized, ambiguousNormalized };
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
  let matchedByNormalized = 0;
  const collisions: MoltobeneSyncCollision[] = [];

  // provola-58507 (bucket C): fallback name-matching. Build the missing-
  // approved-city index ONCE so a moltobene cityName whose raw lower(trim) key
  // doesn't directly match an approved city can still be re-targeted to the
  // approved cityKey via exact normalized-core equality. Conservative: only a
  // UNIQUE missing approved city per normalized core is eligible.
  const { byNormalized: missingByNormalized } =
    await buildMissingApprovedCityIndex();
  // Track normalized cores already consumed in THIS run so two different
  // moltobene cities can't both claim the same missing approved city.
  const consumedNormalized = new Set<string>();

  for (const c of cities) {
    const cityName = typeof c.cityName === 'string' ? c.cityName : '';
    let cityKey = cityName.toLowerCase().trim();
    if (!cityKey) {
      skipped++;
      continue;
    }

    // Bucket C fallback: if the raw key isn't itself a missing approved city,
    // try to recover the approved cityKey by exact normalized-core equality.
    // Only retarget when:
    //   - the raw key is NOT already an approved missing city under its own
    //     normalized core (i.e. the direct path would miss), AND
    //   - the normalized core maps to exactly ONE missing approved cityKey, AND
    //   - that core hasn't already been claimed this run.
    // This NEVER clobbers — the downstream chat_id/cityKey collision guards
    // still apply.
    // provola-58509: canonicalize through the exonym alias map (same as the
    // index keys) so LOCAL incoming names match ENGLISH approved cities.
    const normalizedIncoming = canonicalCityName(cityName);
    if (normalizedIncoming) {
      const target = missingByNormalized.get(normalizedIncoming);
      if (
        target &&
        target !== cityKey &&
        !consumedNormalized.has(normalizedIncoming)
      ) {
        cityKey = target;
        consumedNormalized.add(normalizedIncoming);
        matchedByNormalized++;
      }
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
    matchedByNormalized,
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
  // Find the city whose normalized name matches the requested key. First try
  // the exact raw key (preserves existing behavior), then fall back to exact
  // normalized-core equality so a messy cityKey can still recover its group.
  // provola-58509: canonicalize through the exonym alias map on both sides so a
  // LOCAL cityKey ("goteborg") matches an ENGLISH /city/groups name
  // ("Gothenburg") and vice-versa.
  const wantNorm = canonicalCityName(key);
  let match = cities.find((c) => {
    const name = typeof c.cityName === 'string' ? c.cityName : '';
    return name.toLowerCase().trim() === key;
  });
  if (!match && wantNorm) {
    const normMatches = cities.filter((c) => {
      const name = typeof c.cityName === 'string' ? c.cityName : '';
      return canonicalCityName(name) === wantNorm;
    });
    // Conservative: only accept a UNIQUE normalized match.
    if (normMatches.length === 1) match = normMatches[0];
  }
  if (!match) {
    // provola-58507 (bucket D): /city/groups missed — try /captured-groups
    // (every group the bot is in). Conservative unique normalized match.
    const captures = await fetchCapturedGroups(baseUrl, apiKey);
    if (captures && wantNorm) {
      const capMatches = captures.filter(
        (g) =>
          canonicalCityName(typeof g.title === 'string' ? g.title : '') ===
          wantNorm,
      );
      if (capMatches.length === 1) {
        const cap = capMatches[0];
        const capChatId = parseGroupId(cap.chatId);
        if (capChatId !== null) {
          const region = await getGppRegionByCityKey(key);
          const writeData = {
            chatId: capChatId,
            chatUrl: null,
            isSupergroup: `${cap.chatId}`.trim().startsWith('-100'),
            title: typeof cap.title === 'string' ? cap.title : null,
            source: 'moltobene-capture',
            ...(region ? { region } : {}),
            lastVerifiedAt: new Date(),
          };
          // Don't clobber a row that already holds this chatId under a
          // different cityKey.
          const byChatId = await prisma.cityTelegramGroup.findFirst({
            where: { chatId: capChatId },
            select: { id: true, cityKey: true },
          });
          try {
            if (byChatId && byChatId.cityKey !== key) {
              await prisma.cityTelegramGroup.update({
                where: { id: byChatId.id },
                data: writeData,
              });
            } else {
              await prisma.cityTelegramGroup.upsert({
                where: { cityKey: key },
                create: { cityKey: key, ...writeData },
                update: writeData,
              });
            }
            return capChatId;
          } catch (err: any) {
            console.error(
              `[provola-58507][moltobene-refresh] capture upsert failed for "${key}":`,
              err?.message || err,
            );
            return null;
          }
        }
      }
    }
    return null;
  }

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

// ─── provola-58507: captured-groups backfill ───────────────────────────────
//
// moltobene's NEW `GET /captured-groups` returns EVERY group the bot is in —
// `{ groups: [{ chatId, title, chatType, lastSeenAt }] }` — including groups
// that aren't in moltobene's curated `city` table (so they never came back
// from `/city/groups`, e.g. "goshen"). Same `x-api-key`/MOLTOBENE_API_KEY
// auth. We match each captured group's TITLE (normalized) against the
// normalized core of approved GPP cities that still lack a chat_id, and
// fill-if-empty. Conservative: exact normalized-core equality only, unique on
// both sides, never clobber an existing chat_id.

interface MoltobeneCapturedGroup {
  chatId?: unknown;
  title?: unknown;
  chatType?: unknown;
  lastSeenAt?: unknown;
}

interface MoltobeneCapturedGroupsResponse {
  groups?: MoltobeneCapturedGroup[];
}

/** Normalized captured group with a parsed chat_id (null entries dropped). */
interface NormalizedCapture {
  chatId: bigint;
  rawChatId: string;
  title: string;
  normalized: string;
}

/**
 * Fetch the raw captured-groups list from moltobene. Best-effort: returns null
 * on any config gap / non-2xx / fetch error (callers degrade gracefully).
 */
async function fetchCapturedGroups(
  baseUrl: string,
  apiKey: string,
): Promise<MoltobeneCapturedGroup[] | null> {
  try {
    const url = `${baseUrl.replace(/\/+$/, '')}/captured-groups`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });
    if (!resp.ok) {
      console.warn(
        `[provola-58507][captured-groups] moltobene responded ${resp.status}`,
      );
      return null;
    }
    const payload = (await resp.json()) as MoltobeneCapturedGroupsResponse;
    return Array.isArray(payload?.groups) ? payload.groups : [];
  } catch (err: any) {
    console.warn(
      '[provola-58507][captured-groups] fetch failed:',
      err?.message || err,
    );
    return null;
  }
}

export interface CapturedAmbiguity {
  /** The normalized core that was ambiguous. */
  normalized: string;
  /** Why it was skipped: a city or a title matched more than once. */
  reason: 'multiple-titles-match-city' | 'title-matches-multiple-cities';
  /** Sample cityKeys / titles involved (for the human-readable report). */
  cityKeys?: string[];
  titles?: string[];
}

export interface CapturedGroupsSyncResult {
  ok: boolean;
  reason?: string;
  /** Captured groups received from moltobene. */
  fetched?: number;
  /** Approved GPP cities that lacked a chat_id at the start of the run. */
  missingApproved?: number;
  /** Cities filled (1:1 unambiguous normalized-core matches). */
  matched?: number;
  /** cityKeys that were filled this run. */
  filledCityKeys?: string[];
  /** Ambiguous matches that were NOT auto-applied (need a human). */
  ambiguous?: CapturedAmbiguity[];
  /** Captured groups whose title matched no missing approved city. */
  unmatchedCaptureCount?: number;
}

/**
 * provola-58507: fill missing approved-city chat_ids from moltobene's
 * `GET /captured-groups`.
 *
 * Algorithm (all matching is exact normalized-core equality — NO fuzzy/substr):
 *   1. Build the missing-approved-city index (normalizedCore -> cityKey),
 *      already excluding cores shared by >1 missing city (ambiguous, skipped).
 *   2. Fetch captured groups; normalize each title and group them by core.
 *      A core mapped to by >1 DISTINCT captured chat_id is ambiguous → skip.
 *   3. For each missing city whose core maps to EXACTLY ONE captured group:
 *      fill-if-empty into city_telegram_groups (chatId, title, isSupergroup,
 *      region via GPP slug, source='moltobene-capture', chatUrl=null). Guard:
 *      if that chatId already lives under a DIFFERENT cityKey, skip (don't
 *      create a duplicate); if a row already holds this cityKey WITH a
 *      chatId, skip (fill-if-empty only).
 *
 * Returns counts + the ambiguous list + unmatched capture count for the admin
 * report. Never throws — returns `{ ok:false, reason }` on config gaps.
 */
export async function syncFromCapturedGroups(): Promise<CapturedGroupsSyncResult> {
  const baseUrl = process.env.MOLTOBENE_BASE_URL;
  const apiKey = process.env.MOLTOBENE_API_KEY;
  if (!baseUrl || !apiKey) {
    return { ok: false, reason: 'moltobene sync not configured' };
  }

  const { missing, byNormalized, ambiguousNormalized } =
    await buildMissingApprovedCityIndex();

  const rawGroups = await fetchCapturedGroups(baseUrl, apiKey);
  if (rawGroups === null) {
    return { ok: false, reason: 'captured-groups fetch failed' };
  }

  // Normalize captures, dropping invalid chat_ids / empty titles.
  const captures: NormalizedCapture[] = [];
  for (const g of rawGroups) {
    const chatId = parseGroupId(g.chatId);
    if (chatId === null) continue;
    const title = typeof g.title === 'string' ? g.title : '';
    // provola-58509: canonicalize captured titles through the exonym alias map
    // so LOCAL group names match the canonical core of ENGLISH approved cities.
    const normalized = canonicalCityName(title);
    if (!normalized) continue;
    captures.push({
      chatId,
      rawChatId: `${g.chatId}`.trim(),
      title,
      normalized,
    });
  }

  // core -> distinct captured groups (dedupe by chatId).
  const coreToCaptures = new Map<string, Map<string, NormalizedCapture>>();
  for (const cap of captures) {
    const byId = coreToCaptures.get(cap.normalized) ?? new Map<string, NormalizedCapture>();
    if (!byId.has(cap.rawChatId)) byId.set(cap.rawChatId, cap);
    coreToCaptures.set(cap.normalized, byId);
  }

  const ambiguous: CapturedAmbiguity[] = [];

  // Report the city-side ambiguities surfaced by the index build (>1 missing
  // city sharing a normalized core).
  for (const core of ambiguousNormalized) {
    ambiguous.push({
      normalized: core,
      reason: 'title-matches-multiple-cities',
    });
  }

  const filledCityKeys: string[] = [];
  let matched = 0;
  const matchedCores = new Set<string>();

  for (const [core, cityKey] of byNormalized) {
    const capById = coreToCaptures.get(core);
    if (!capById || capById.size === 0) continue; // no captured group for this city.

    if (capById.size > 1) {
      // The same normalized core is held by multiple distinct captured groups
      // — we can't tell which one is the real city. Skip + report.
      ambiguous.push({
        normalized: core,
        reason: 'multiple-titles-match-city',
        cityKeys: [cityKey],
        titles: [...capById.values()].map((c) => c.title),
      });
      continue;
    }

    const cap = [...capById.values()][0];

    try {
      // Don't duplicate a chatId already owned by a different cityKey.
      const byChatId = await prisma.cityTelegramGroup.findFirst({
        where: { chatId: cap.chatId },
        select: { id: true, cityKey: true },
      });
      if (byChatId && byChatId.cityKey !== cityKey) {
        console.warn(
          `[provola-58507][captured-groups] chat_id ${cap.chatId} already on ` +
            `cityKey "${byChatId.cityKey}" — skipping fill for "${cityKey}".`,
        );
        continue;
      }

      // Fill-if-empty: skip if a row already holds this cityKey WITH a chatId.
      const existing = await prisma.cityTelegramGroup.findUnique({
        where: { cityKey },
        select: { chatId: true },
      });
      if (existing && existing.chatId !== null) {
        continue;
      }

      const region = await getGppRegionByCityKey(cityKey);
      const writeData = {
        chatId: cap.chatId,
        chatUrl: null,
        title: cap.title || null,
        isSupergroup: cap.rawChatId.startsWith('-100'),
        source: 'moltobene-capture',
        ...(region ? { region } : {}),
        lastVerifiedAt: new Date(),
      };

      await prisma.cityTelegramGroup.upsert({
        where: { cityKey },
        create: { cityKey, ...writeData },
        update: writeData,
      });
      matched++;
      matchedCores.add(core);
      filledCityKeys.push(cityKey);
    } catch (err: any) {
      console.error(
        `[provola-58507][captured-groups] fill failed for "${cityKey}":`,
        err?.message || err,
      );
    }
  }

  // Unmatched captures = captured cores that didn't fill any missing city.
  let unmatchedCaptureCount = 0;
  for (const core of coreToCaptures.keys()) {
    if (!matchedCores.has(core)) unmatchedCaptureCount++;
  }

  return {
    ok: true,
    fetched: rawGroups.length,
    missingApproved: missing.length,
    matched,
    filledCityKeys,
    ambiguous,
    unmatchedCaptureCount,
  };
}
