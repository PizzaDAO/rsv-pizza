/**
 * grissini-58492: one-time (re-runnable) backfill of city Telegram group
 * `chat_id`s for GPP parties that don't have one yet, by resolving the
 * `parties.telegram_group` URL via the bot's `getChat`.
 *
 * Builds on the LIVE tonda-58293 per-city model: it fills MISSING
 * `city_telegram_groups.chat_id` rows (keyed by `city_key`). It does NOT
 * redesign the table.
 *
 * Run manually with DATABASE_URL + TELEGRAM_BOT_TOKEN set (the MAIN SESSION
 * runs this against prod; the implementation agent does NOT run it):
 *
 *   cd backend
 *   DATABASE_URL=... TELEGRAM_BOT_TOKEN=... npx tsx scripts/resolve-telegram-groups-from-urls.ts --dry-run
 *   DATABASE_URL=... TELEGRAM_BOT_TOKEN=... npx tsx scripts/resolve-telegram-groups-from-urls.ts
 *   # --dry-run prints what WOULD be written, no DB writes.
 *
 * HOW IT WORKS
 * 1. Load non-cancelled GPP parties that have a non-empty `telegram_group`.
 * 2. Derive cityKey via `cityKeyFromPartyName` (fallback: lower(trim(name))).
 * 3. Skip cities that already have a `chat_id` (we only fill MISSING ones).
 * 4. Parse the URL to a PUBLIC username, or classify as private / unparseable.
 *    - PUBLIC (resolvable by getChat): t.me/<user>, t.me/s/<user>,
 *      telegram.me/<user>, @<user>, bare <user> matching ^[A-Za-z]\w{3,}$,
 *      where <user> is NOT `joinchat` and does NOT start with `+`.
 *    - PRIVATE (NOT resolvable): t.me/+<hash>, t.me/joinchat/<hash>, any `+`.
 *    - Unparseable → skip.
 * 5. For PUBLIC: call Telegram `getChat` (works WITHOUT bot membership for
 *    public chats). A public city group is usually a `supergroup`. Treat
 *    `channel` / `private` as not-a-group (wrongType). Rate-limit ~150ms.
 * 6. Upsert resolved public groups into `city_telegram_groups` by cityKey:
 *    chatId, chatUrl (original URL), title, isSupergroup, source='url',
 *    region (GPP slug), lastVerifiedAt=now(). Idempotent.
 *
 * Why getChat works without membership: Telegram's Bot API resolves PUBLIC
 * usernames (t.me/<user>) to their chat object even if the bot is not a member.
 * Private invite links (t.me/+... / joinchat) carry no public username, so
 * getChat cannot resolve them — those cities still need the bot added to the
 * group (or a host `/register`) before a chat_id can be captured.
 */
import { PrismaClient } from '@prisma/client';
import {
  cityKeyFromPartyName,
  buildGppCityKeyToRegionMap,
} from '../src/helpers/underbossScope';

const prisma = new PrismaClient();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? '';
const GET_CHAT_DELAY_MS = 150;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type ParseResult =
  | { kind: 'public'; username: string }
  | { kind: 'private' }
  | { kind: 'unparseable' };

/**
 * Validate a Telegram public username candidate. Public usernames are
 * 5–32 chars, must start with a letter, allow letters/digits/underscore.
 * We require >=4 chars after the leading letter (^[A-Za-z]\w{3,}$, i.e. >=5
 * total) per the task spec, and reject the `joinchat` keyword and anything
 * starting with `+` (those are private invite links, not usernames).
 */
function isPublicUsername(candidate: string): boolean {
  if (!candidate) return false;
  if (candidate.startsWith('+')) return false;
  if (candidate.toLowerCase() === 'joinchat') return false;
  return /^[A-Za-z][A-Za-z0-9_]{3,}$/.test(candidate);
}

/**
 * Parse a `parties.telegram_group` value into a public username, or classify
 * it as private (invite link) or unparseable.
 *
 * Accepted PUBLIC forms (case-insensitive host):
 *   https://t.me/<user>            t.me/<user>
 *   https://t.me/s/<user>          t.me/s/<user>      (web-preview prefix)
 *   https://telegram.me/<user>     telegram.me/<user>
 *   @<user>                        <user>             (bare)
 *
 * PRIVATE (return {private}): any value containing `+`, `joinchat`.
 */
function parseTelegramUrl(raw: string): ParseResult {
  const value = (raw || '').trim();
  if (!value) return { kind: 'unparseable' };

  const lower = value.toLowerCase();

  // Private invite links are never resolvable by getChat.
  if (value.includes('+') || lower.includes('joinchat')) {
    return { kind: 'private' };
  }

  // Bare @username or plain username (no slash, not a URL).
  if (!value.includes('/') && !lower.includes('t.me') && !lower.includes('telegram.me')) {
    const candidate = value.replace(/^@/, '').trim();
    return isPublicUsername(candidate) ? { kind: 'public', username: candidate } : { kind: 'unparseable' };
  }

  // URL form — pull out the host + path. Tolerate missing scheme.
  let host = '';
  let path = '';
  try {
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const u = new URL(withScheme);
    host = u.hostname.toLowerCase();
    path = u.pathname;
  } catch {
    return { kind: 'unparseable' };
  }

  if (host !== 't.me' && host !== 'telegram.me' && host !== 'www.t.me' && host !== 'www.telegram.me') {
    return { kind: 'unparseable' };
  }

  // Split the path; drop a leading `s` (web-preview) segment.
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return { kind: 'unparseable' };
  if (segments[0].toLowerCase() === 's') segments.shift();
  if (segments.length === 0) return { kind: 'unparseable' };

  const first = segments[0];
  if (first.startsWith('+') || first.toLowerCase() === 'joinchat') {
    return { kind: 'private' };
  }

  const candidate = first.replace(/^@/, '').trim();
  return isPublicUsername(candidate) ? { kind: 'public', username: candidate } : { kind: 'unparseable' };
}

interface GetChatGroup {
  id: bigint;
  type: string;
  title: string | null;
}

type GetChatResult =
  | { ok: true; group: GetChatGroup }
  | { ok: false; description: string };

/**
 * Resolve a public username to its chat via the Telegram Bot API. getChat
 * resolves PUBLIC usernames without the bot being a member.
 */
async function getChat(username: string): Promise<GetChatResult> {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getChat?chat_id=${encodeURIComponent('@' + username)}`;
  let json: any;
  try {
    const resp = await fetch(url);
    json = await resp.json();
  } catch (err) {
    return { ok: false, description: `network error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!json?.ok) {
    return { ok: false, description: String(json?.description ?? 'unknown getChat error') };
  }
  const result = json.result ?? {};
  return {
    ok: true,
    group: {
      id: BigInt(result.id),
      type: String(result.type ?? ''),
      title: result.title ? String(result.title) : null,
    },
  };
}

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  console.log(`[resolve-telegram-groups-from-urls] starting (dryRun=${dryRun})...`);

  if (!TELEGRAM_BOT_TOKEN) {
    console.error('[resolve-telegram-groups-from-urls] FATAL: TELEGRAM_BOT_TOKEN is not set.');
    process.exitCode = 1;
    return;
  }

  // 1) GPP parties with a non-empty telegram_group link.
  const parties = await prisma.party.findMany({
    where: {
      eventType: 'gpp',
      cancelledAt: null,
      telegramGroup: { not: null },
    },
    select: { id: true, name: true, telegramGroup: true },
  });
  const partiesWithUrl = parties.filter((p) => (p.telegramGroup ?? '').trim().length > 0);
  console.log(`[resolve-telegram-groups-from-urls] ${partiesWithUrl.length} GPP parties with a telegram_group URL`);

  // Existing cities that ALREADY have a chat_id — these are skipped.
  const existing = await prisma.cityTelegramGroup.findMany({
    where: { chatId: { not: null } },
    select: { cityKey: true },
  });
  const cityKeysWithChatId = new Set(existing.map((g) => g.cityKey));

  // tonda-58293 FIX #1: region must be the GPP slug. Build the cityKey→region
  // map ONCE (the helper doc warns against calling getGppRegionByCityKey in a
  // loop); look up per cityKey from this map below.
  const cityKeyToRegion = await buildGppCityKeyToRegionMap();

  // De-dup by cityKey: multiple parties can resolve to the same city. First
  // party (with a URL) wins; later duplicates are ignored.
  const byCityKey = new Map<string, { partyName: string; url: string }>();
  for (const p of partiesWithUrl) {
    const cityKey = cityKeyFromPartyName(p.name) ?? (p.name ?? '').toLowerCase().trim();
    if (!cityKey) continue;
    if (!byCityKey.has(cityKey)) {
      byCityKey.set(cityKey, { partyName: p.name ?? '', url: (p.telegramGroup ?? '').trim() });
    }
  }

  let alreadyHave = 0;
  let publicAttempted = 0;
  let resolved = 0;
  let privateCount = 0;
  let unparseable = 0;
  let getChatFailed = 0;
  let wrongType = 0;

  const privateList: string[] = [];
  const unparseableList: string[] = [];
  const getChatFailedList: string[] = [];

  for (const [cityKey, { url }] of byCityKey) {
    // 3) Skip cities that already have a chat_id — only fill MISSING ones.
    if (cityKeysWithChatId.has(cityKey)) {
      alreadyHave++;
      continue;
    }

    // 4) Parse the URL.
    const parsed = parseTelegramUrl(url);
    if (parsed.kind === 'private') {
      privateCount++;
      privateList.push(`${cityKey} (${url})`);
      continue;
    }
    if (parsed.kind === 'unparseable') {
      unparseable++;
      unparseableList.push(`${cityKey} (${url})`);
      continue;
    }

    // 5) PUBLIC → getChat.
    publicAttempted++;
    const res = await getChat(parsed.username);
    await sleep(GET_CHAT_DELAY_MS);

    if (!res.ok) {
      getChatFailed++;
      getChatFailedList.push(`${cityKey} (@${parsed.username}): ${res.description}`);
      continue;
    }

    const { id: chatId, type, title } = res.group;

    // A resolvable city group is a group or supergroup. Channels/users aren't.
    if (type !== 'group' && type !== 'supergroup') {
      wrongType++;
      console.log(`[wrong-type] ${cityKey} (@${parsed.username}) -> type=${type || '(unknown)'} — skipped`);
      continue;
    }

    const isSupergroup = type === 'supergroup';
    const region = cityKeyToRegion.get(cityKey) ?? null;

    if (dryRun) {
      console.log(
        `[dry-run] ${cityKey} -> chat_id=${chatId.toString()} type=${type} supergroup=${isSupergroup} region=${region ?? '(none)'} title=${title ?? '(none)'} url=${url}`,
      );
      resolved++;
      continue;
    }

    // 6) Upsert the resolved public group.
    await prisma.cityTelegramGroup.upsert({
      where: { cityKey },
      create: {
        cityKey,
        chatId,
        chatUrl: url,
        title,
        isSupergroup,
        region,
        source: 'url',
        lastVerifiedAt: new Date(),
      },
      update: {
        chatId,
        chatUrl: url,
        title,
        isSupergroup,
        region,
        source: 'url',
        lastVerifiedAt: new Date(),
      },
    });
    resolved++;
    console.log(`[resolved] ${cityKey} -> chat_id=${chatId.toString()} (${type})`);
  }

  // 7) Final summary.
  console.log('\n=== [resolve-telegram-groups-from-urls] SUMMARY ===');
  console.log(`GPP parties with a URL : ${partiesWithUrl.length} (${byCityKey.size} unique cityKeys)`);
  console.log(`alreadyHave (skipped)  : ${alreadyHave}`);
  console.log(`public attempted       : ${publicAttempted}`);
  console.log(`resolved (newly fillable)${dryRun ? ' [dry-run, not written]' : ''}: ${resolved}`);
  console.log(`private (skipped)      : ${privateCount}`);
  console.log(`unparseable (skipped)  : ${unparseable}`);
  console.log(`getChatFailed (skipped): ${getChatFailed}`);
  console.log(`wrongType (skipped)    : ${wrongType}`);

  if (privateList.length) {
    console.log('\n--- PRIVATE links (need bot-in-group / host /register) ---');
    for (const line of privateList) console.log(`  ${line}`);
  }
  if (getChatFailedList.length) {
    console.log('\n--- getChat FAILED (need bot-in-group / host /register) ---');
    for (const line of getChatFailedList) console.log(`  ${line}`);
  }
  if (unparseableList.length) {
    console.log('\n--- UNPARSEABLE telegram_group values (not a t.me URL) ---');
    for (const line of unparseableList) console.log(`  ${line}`);
  }

  console.log(`\n[resolve-telegram-groups-from-urls] done${dryRun ? ' (dry-run)' : ''}.`);
}

main()
  .catch((err) => {
    console.error('[resolve-telegram-groups-from-urls] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
