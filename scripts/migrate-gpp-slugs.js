/**
 * Migrate GPP event slugs to match English city names.
 * - Strips diacritics
 * - Updates custom_url
 * - Inserts old slug into slug_aliases for redirects
 *
 * Run: node scripts/migrate-gpp-slugs.js          (dry run)
 * Run: node scripts/migrate-gpp-slugs.js --apply   (real run)
 */

const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const DRY_RUN = !process.argv.includes('--apply');

function generateSlug(cityName) {
  return cityName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Extract just the city name from the event name, stripping sponsors/suffixes
function extractCity(eventName) {
  const match = eventName.match(/Global Pizza Party\s+[-–—]?\s*(.+)/);
  if (!match) return null;
  let city = match[1].trim();
  // Strip trailing sponsor/venue info after " - " (keep first segment only)
  city = city.split(/\s+[-–—]\s+/)[0].trim();
  // Strip leading dashes
  city = city.replace(/^[-–—\s]+/, '');
  return city || null;
}

async function main() {
  const events = await p.party.findMany({
    where: { eventType: 'gpp' },
    select: { id: true, name: true, customUrl: true },
  });

  const changes = [];
  const newSlugSet = new Set(); // Track new slugs to detect collisions among changes

  // Collect existing slugs for collision detection
  const existingSlugs = new Set(events.map(e => e.customUrl).filter(Boolean));

  for (const e of events) {
    const city = extractCity(e.name);
    if (!city) continue;

    const newSlug = generateSlug(city);

    if (!newSlug || newSlug === e.customUrl) continue;

    // Skip if new slug is longer and already contains the old slug as-is
    // (means old slug is already the clean city, event name has extra info)
    if (newSlug.length > e.customUrl.length && newSlug.includes(e.customUrl)) continue;

    // Check for collision among new slugs
    if (newSlugSet.has(newSlug)) {
      console.log(`  COLLISION (dup new slug): ${e.name} -> ${newSlug} (already taken by another change)`);
      continue;
    }
    newSlugSet.add(newSlug);

    changes.push({
      id: e.id,
      name: e.name,
      oldSlug: e.customUrl,
      newSlug,
    });
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  GPP Slug Migration -- ${DRY_RUN ? 'DRY RUN' : 'APPLYING'}`);
  console.log(`${'='.repeat(60)}\n`);
  console.log(`Total GPP events: ${events.length}`);
  console.log(`Slugs to change: ${changes.length}\n`);

  for (const c of changes) {
    const collision = existingSlugs.has(c.newSlug) && c.newSlug !== c.oldSlug;
    console.log(`  ${c.name}`);
    console.log(`    ${c.oldSlug} -> ${c.newSlug}${collision ? ' ** COLLISION' : ''}`);
  }

  // Filter out collisions with existing slugs
  const safeChanges = changes.filter(c => !existingSlugs.has(c.newSlug) || c.newSlug === c.oldSlug);
  const skipped = changes.length - safeChanges.length;
  if (skipped > 0) {
    console.log(`\n  Skipping ${skipped} changes due to collisions with existing slugs.`);
  }

  if (!DRY_RUN && safeChanges.length > 0) {
    console.log(`\nApplying ${safeChanges.length} changes...`);
    for (const c of safeChanges) {
      // Insert alias for old slug
      await p.slugAlias.create({
        data: { oldSlug: c.oldSlug, partyId: c.id },
      });
      // Update custom_url
      await p.party.update({
        where: { id: c.id },
        data: { customUrl: c.newSlug },
      });
      console.log(`  OK ${c.oldSlug} -> ${c.newSlug}`);
    }
    console.log(`\nApplied ${safeChanges.length} slug changes.`);
  } else if (DRY_RUN) {
    console.log(`\nRun with --apply to execute these changes.`);
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
