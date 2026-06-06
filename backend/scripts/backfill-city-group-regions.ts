/**
 * tonda-58293 FIX #1: backfill `city_telegram_groups.region` with the GPP
 * region SLUG (e.g. `western-europe`) derived from the matching GPP party,
 * replacing the legacy sheet free-text region names (e.g. "Western Europe").
 *
 * WHY: `underbosses.regions` and `parties.region` hold GPP slugs, but the
 * original import wrote the sheet's free-text region NAME into
 * `city_telegram_groups.region`. They never match, so region-scoped underbosses
 * saw 0 groups and got 403'd on assign/test/refresh. Non-sheet rows were NULL.
 *
 * After this runs, region-vs-region comparisons are slug-vs-slug and work.
 *
 * Run manually with DATABASE_URL set (the MAIN SESSION runs this against prod;
 * the implementation agent does NOT run it):
 *
 *   cd backend
 *   DATABASE_URL=... npx tsx scripts/backfill-city-group-regions.ts
 *   # add --dry-run to print what would change without writing
 *
 * Idempotent: re-running produces no further changes once every row already
 * holds the derived slug (or null where no GPP party yields its cityKey).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Mirror of `cityKeyFromPartyName` in src/helpers/underbossScope.ts — inlined so
 * this standalone tsx script stays dependency-free. Keep in sync:
 * "Global Pizza Party {City}" → lower(trim(City)).
 */
function cityKeyFromPartyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const match = name.match(/Global Pizza Party\s+(.+)/i);
  if (!match) return null;
  return match[1].trim().toLowerCase();
}

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  console.log(`[backfill-city-group-regions] starting (dryRun=${dryRun})...`);

  // Single batched pass: cityKey → GPP region slug from non-cancelled GPP
  // parties (first non-null region wins on a cityKey collision).
  const parties = await prisma.party.findMany({
    where: { eventType: 'gpp', cancelledAt: null },
    select: { name: true, region: true },
  });
  const cityKeyToRegion = new Map<string, string>();
  for (const p of parties) {
    const key = cityKeyFromPartyName(p.name);
    if (!key) continue;
    const region = (p.region ?? '').trim();
    if (!region) continue;
    if (!cityKeyToRegion.has(key)) cityKeyToRegion.set(key, region);
  }
  console.log(`[backfill-city-group-regions] derived ${cityKeyToRegion.size} cityKey→region slugs from ${parties.length} GPP parties`);

  const groups = await prisma.cityTelegramGroup.findMany({
    select: { id: true, cityKey: true, region: true },
  });

  let updated = 0;
  let unchanged = 0;
  let cleared = 0;
  for (const g of groups) {
    const desired = cityKeyToRegion.get(g.cityKey) ?? null; // null when no GPP party
    if ((g.region ?? null) === desired) {
      unchanged++;
      continue;
    }
    if (dryRun) {
      console.log(`[dry-run] ${g.cityKey}: ${g.region ?? '(null)'} -> ${desired ?? '(null)'}`);
    } else {
      await prisma.cityTelegramGroup.update({
        where: { id: g.id },
        data: { region: desired },
      });
    }
    if (desired === null) cleared++;
    else updated++;
  }

  console.log(
    `[backfill-city-group-regions] done${dryRun ? ' (dry-run)' : ''} — ${updated} set to a slug, ${cleared} cleared to null (no GPP party), ${unchanged} already correct, ${groups.length} total rows`,
  );
}

main()
  .catch((err) => {
    console.error('[backfill-city-group-regions] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
