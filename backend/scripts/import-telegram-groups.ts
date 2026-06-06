/**
 * tonda-58293: one-time import of the city → Telegram group chat_id mapping
 * from the legacy Google Sheet into the new `city_telegram_groups` table.
 *
 * Run manually with DATABASE_URL set (the main session runs this AFTER the
 * `tonda-58293-city-telegram-groups.sql` migration is applied to prod):
 *
 *   cd backend
 *   DATABASE_URL=... npx tsx scripts/import-telegram-groups.ts
 *   # add --dry-run to print what would change without writing
 *
 * Idempotent: upserts keyed by city_key, so re-running is safe. Only rows
 * whose groupId matches /^-?\d+$/ are imported (skips blanks / "tbd" / "x").
 * `source` is set to 'sheet' for every imported row.
 *
 * Sheet source: same gviz JSON URL the frontend `fetchTelegramGroups()` uses.
 *   col 4  = country   (display only)
 *   col 5  = city
 *   col 6  = underboss (display only)
 *   col 7  = region    (IGNORED for the DB region — see FIX #1 below)
 *   col 8  = chatUrl
 *   col 10 = groupId (chat_id)
 *
 * tonda-58293 FIX #1: `city_telegram_groups.region` stores the GPP region SLUG
 * (e.g. `western-europe`) derived from the matching GPP party, not the sheet's
 * free-text region name (e.g. "Western Europe"). The sheet name never matches
 * `underbosses.regions`/`parties.region`, which are slugs.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Mirror of `cityKeyFromPartyName` in src/helpers/underbossScope.ts — inlined so
 * this standalone tsx script stays dependency-free (like the other scripts).
 * Keep in sync: "Global Pizza Party {City}" → lower(trim(City)).
 */
function cityKeyFromPartyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const match = name.match(/Global Pizza Party\s+(.+)/i);
  if (!match) return null;
  return match[1].trim().toLowerCase();
}

/**
 * tonda-58293 FIX #1: build cityKey → GPP region-slug map from non-cancelled
 * GPP parties. `city_telegram_groups.region` must hold the GPP slug (e.g.
 * `western-europe`) — the same value as `parties.region` and `underbosses.regions`
 * — NOT the sheet's free-text region name (e.g. "Western Europe"), or
 * region-scoped underbosses never match. Single batched pass (no N+1).
 */
async function buildCityKeyToRegion(): Promise<Map<string, string>> {
  const parties = await prisma.party.findMany({
    where: { eventType: 'gpp', cancelledAt: null },
    select: { name: true, region: true },
  });
  const map = new Map<string, string>();
  for (const p of parties) {
    const key = cityKeyFromPartyName(p.name);
    if (!key) continue;
    const region = (p.region ?? '').trim();
    if (!region) continue;
    if (!map.has(key)) map.set(key, region);
  }
  return map;
}

const SHEET_ID = '16T3_iXywToXQqxTyDIniWIA4SUI8Wj0a5LKHSAJL_9Q';
const GID = '811297100';

interface SheetRow {
  country: string;
  city: string;
  underboss: string;
  region: string;
  chatUrl: string;
  groupId: string;
}

async function fetchSheetRows(): Promise<SheetRow[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${GID}&headers=11`;
  const response = await fetch(url);
  const text = await response.text();
  // Strip the JSONP wrapper: google.visualization.Query.setResponse({...})
  const json = JSON.parse(text.replace(/^[^(]*\(/, '').replace(/\);?$/, ''));

  return (json.table.rows as any[])
    .map((row: any): SheetRow => ({
      country: String(row.c?.[4]?.v ?? '').trim(),
      city: String(row.c?.[5]?.v ?? '').trim(),
      underboss: String(row.c?.[6]?.v ?? '').trim(),
      region: String(row.c?.[7]?.v ?? '').trim(),
      chatUrl: String(row.c?.[8]?.v ?? '').trim(),
      groupId: String(row.c?.[10]?.v ?? '').replace('#', '').trim(),
    }))
    .filter((r) => r.city && r.groupId && /^-?\d+$/.test(r.groupId));
}

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');

  console.log(`[import-telegram-groups] fetching sheet (dryRun=${dryRun})...`);
  const rows = await fetchSheetRows();
  console.log(`[import-telegram-groups] ${rows.length} valid sheet rows`);

  // De-dup by cityKey: last writer wins (sheet may carry duplicate cities).
  const byCityKey = new Map<string, SheetRow>();
  for (const r of rows) {
    byCityKey.set(r.city.toLowerCase().trim(), r);
  }

  // tonda-58293 FIX #1: region comes from the GPP party slug (cityKey-derived),
  // not the sheet's free-text region column. Sheet country/underboss stay
  // (display only). Cities with no GPP party fall back to null region.
  const cityKeyToRegion = await buildCityKeyToRegion();

  let upserted = 0;
  let skipped = 0;
  for (const [cityKey, r] of byCityKey) {
    const chatId = BigInt(r.groupId);
    const isSupergroup = r.groupId.startsWith('-100');
    const region = cityKeyToRegion.get(cityKey) ?? null;

    if (dryRun) {
      console.log(
        `[dry-run] ${cityKey} -> chat_id=${chatId.toString()} supergroup=${isSupergroup} region=${region ?? '(none)'} url=${r.chatUrl || '(none)'}`,
      );
      skipped++;
      continue;
    }

    const country = r.country || null;
    const underboss = r.underboss || null;

    await prisma.cityTelegramGroup.upsert({
      where: { cityKey },
      create: {
        cityKey,
        chatId,
        chatUrl: r.chatUrl || null,
        country,
        underboss,
        region,
        isSupergroup,
        source: 'sheet',
        lastVerifiedAt: new Date(),
      },
      update: {
        chatId,
        chatUrl: r.chatUrl || null,
        country,
        underboss,
        region,
        isSupergroup,
        source: 'sheet',
        lastVerifiedAt: new Date(),
      },
    });
    upserted++;
  }

  console.log(
    `[import-telegram-groups] done — ${upserted} upserted, ${skipped} skipped${dryRun ? ' (dry-run)' : ''} from ${byCityKey.size} unique cities`,
  );
}

main()
  .catch((err) => {
    console.error('[import-telegram-groups] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
