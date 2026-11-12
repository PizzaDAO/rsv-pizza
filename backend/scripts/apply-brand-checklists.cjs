#!/usr/bin/env node
/** Seed the approved preset host checklists (plans/wl-streamlined-create.md §3f) for each brand series
 *  that has NO series-scoped checklist_defaults yet.
 *  Idempotent: a series that already has any rows is left alone, so edits made at /admin/series win.
 *  DRY RUN by default (read-only); --apply to write. Plain statements only (6543 transaction pooler).
 *  Auto rules are limited to the generic ones in checklist.routes.ts; never party_kit_submitted /
 *  budget_submitted (GPP money/kit). */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

// [name, autoRule|null, linkTab|null]
const PARTY = [
  ['Create your event', 'event_created', null],
  ['Get approved', 'underboss_reviewed', null],
  ['Pick a venue', 'venue_added', 'venue'],
  ['Choose a pizzeria', 'pizzerias_selected', 'pizza'],
  ['Add a co-host', 'team_built', null],
  ['Share your invite link', null, null],
  ['Post on X with #DogeDay', null, null],
  ['Estimate attendance', 'attendance_estimated', 'attendance'],
  ['Upload photos after the party', null, 'photos'],
];
const MEETUP = [
  ['Create your event', 'event_created', null],
  ['Get approved', 'underboss_reviewed', null],
  ['Confirm venue', 'venue_added', 'venue'],
  ['Choose a pizzeria', 'pizzerias_selected', 'pizza'],
  ['Line up a speaker or topic', null, null],
  ['Share in your Team1 community chat', null, null],
  ['Estimate attendance', 'attendance_estimated', 'attendance'],
  ['Post photos and a recap', null, 'photos'],
  ['Schedule the next meetup', null, null],
];
const HACKATHON = [
  ['Create your event', 'event_created', null],
  ['Get approved', 'underboss_reviewed', null],
  ['Confirm venue and Wi-Fi/power', 'venue_added', 'venue'],
  ['Set capacity and review applications', null, 'guests'],
  ['Publish tracks, prizes and rules', null, 'details'],
  ['Line up judges and mentors', null, null],
  ['Plan meals per day: choose pizzerias', 'pizzerias_selected', 'pizza'],
  ['Add a co-host or volunteers', 'team_built', null],
  ['Day-of: check-in and displays', null, 'displays'],
  ['Post winners and photos', null, 'photos'],
];
const PLAN = { doge: PARTY, team1: MEETUP, monad: HACKATHON };

(async () => {
  console.log(`\n=== brand checklists (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
  for (const [slug, rows] of Object.entries(PLAN)) {
    const series = await prisma.eventSeries.findUnique({ where: { slug }, select: { id: true } });
    if (!series) { console.log(`SKIP '${slug}': series does not exist yet`); continue; }
    const have = await prisma.checklistDefault.count({ where: { seriesId: series.id } });
    if (have > 0) { console.log(`OK   '${slug}' already has ${have} checklist defaults - leaving alone`); continue; }
    console.log(`${APPLY ? 'Seeding' : 'Would seed'} '${slug}' with ${rows.length} items:`);
    rows.forEach(([name, rule, tab], i) => console.log(`  ${String(i + 1).padStart(2)}. ${name}${rule ? `  [auto: ${rule}]` : ''}${tab ? `  -> ${tab}` : ''}`));
    if (!APPLY) continue;
    await prisma.checklistDefault.createMany({
      data: rows.map(([name, autoRule, linkTab], i) => ({
        name, isAuto: !!autoRule, autoRule, linkTab, sortOrder: i + 1, seriesId: series.id,
      })),
      skipDuplicates: true,
    });
    const after = await prisma.checklistDefault.count({ where: { seriesId: series.id } });
    console.log(after === rows.length ? `OK   verified ${after} rows for '${slug}'` : `FAIL '${slug}' has ${after} rows, expected ${rows.length}`);
    if (after !== rows.length) process.exitCode = 1;
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
