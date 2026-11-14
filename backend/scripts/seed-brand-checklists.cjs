#!/usr/bin/env node
/**
 * brand-checklists: grow the brand-series host checklists (Team1, Monad, Doge Day)
 * into full "prepare for the party" task lists, adapted from the GPP host list.
 *
 * How brand task lists work (same mechanism as GPP): a party seeds its checklist
 * from `checklist_defaults` rows scoped to its event series (series_id), falling
 * back to the global GPP template (series_id IS NULL) only when the series has
 * none (backend/src/routes/checklist.routes.ts). Brand parties reach the list via
 * the pinned "Checklist" app (backend/src/lib/createPresets.ts pinnedApps).
 *
 * The three brand series already have a short list (backend/scripts/
 * apply-brand-checklists.cjs). This script keeps every one of those rows (same
 * names) and ADDS the missing items, then puts all rows in the planned order.
 *
 * Per series, in ONE transaction (6543 transaction pooler: plain statements, no
 * session SETs):
 *   (a) FIRST backfill the new items into checklist_items for every party that is
 *       already fully seeded from this series' template. Otherwise the seed
 *       endpoint sees is_default count < template count, deletes the party's
 *       default rows and re-creates them, wiping the host's ticked items (same
 *       reason as backfill-social-post-checklist.cjs). Parties not fully seeded
 *       are skipped; the app seeds them fresh on next open.
 *   (b) insert the missing checklist_defaults rows (ON CONFLICT DO NOTHING).
 *   (c) realign sort_order of the existing default rows (and of those parties'
 *       default items) to the planned order. Names, rules and links are untouched.
 *
 * Idempotent: existing names are skipped; a second run inserts nothing.
 * Rows that exist in the DB but not in the plan (e.g. added at /admin/series)
 * are left alone and listed.
 *
 * DRY RUN by default (read-only transaction, prints exactly what would change).
 * Pass --apply to write.
 *
 * Usage: node backend/scripts/seed-brand-checklists.cjs [--apply]
 */

const path = require('path');

// Auto rules computed by GET /:partyId/checklist that make sense outside GPP.
// Never party_kit_submitted / budget_submitted (GPP kit + reimbursement).
const BRAND_AUTO_RULES = new Set([
  'event_created', 'venue_added', 'team_built', 'pizzerias_selected',
  'underboss_reviewed', 'attendance_estimated',
]);
// HostPage tabs (or ChecklistTab modal sentinels: venue, attendance, social-post).
const VALID_LINK_TABS = new Set([
  'details', 'venue', 'pizza', 'guests', 'photos', 'partners', 'staff', 'displays',
  'promo', 'flyer', 'print', 'party-guide', 'attendance', 'social-post',
]);

// [name, autoRule|null, linkTab|null] in display order.
// Rows marked "existing" are already in prod (apply-brand-checklists.cjs) and must
// keep their exact name so they are skipped, not duplicated.
const BRAND_CHECKLISTS = {
  // Doge Day: one global celebration on Nov 2, Doge/Kabosu themed.
  doge: [
    ['Create your event', 'event_created', null], // existing
    ['Get approved', 'underboss_reviewed', null], // existing
    ['Add a co-host', 'team_built', null], // existing
    ['Pick a venue', 'venue_added', 'venue'], // existing
    ['Estimate attendance', 'attendance_estimated', 'attendance'], // existing
    ['Choose a pizzeria', 'pizzerias_selected', 'pizza'], // existing
    ['Find partners', null, 'partners'],
    ['Customize your flyer', null, 'flyer'],
    ['Share your invite link', null, null], // existing
    ['Share the Doge Day countdown', null, null],
    ['Post on X with #DogeDay', null, null], // existing
    ['Plan Doge decor and a Kabosu photo spot', null, null],
    ['Print flyers and stickers', null, 'print'],
    ['Pick a photo/video person', null, null],
    ['Use your Party Guide on Doge Day', null, 'party-guide'],
    ['Upload photos after the party', null, 'photos'], // existing
  ],
  // Team1: community meetup.
  team1: [
    ['Create your event', 'event_created', null], // existing
    ['Get approved', 'underboss_reviewed', null], // existing
    ['Confirm venue', 'venue_added', 'venue'], // existing
    ['Line up a speaker or topic', null, null], // existing
    ['Add a co-host', 'team_built', null],
    ['Estimate attendance', 'attendance_estimated', 'attendance'], // existing
    ['Choose a pizzeria', 'pizzerias_selected', 'pizza'], // existing
    ['Share in your Team1 community chat', null, null], // existing
    ['Post to socials', null, 'social-post'],
    ['Remind guests the day before', null, 'guests'],
    ['Print name tags for check-in', null, 'print'],
    ['Pick a photo/video person', null, null],
    ['Post photos and a recap', null, 'photos'], // existing
    ['Schedule the next meetup', null, null], // existing
  ],
  // Monad: multi-day hackathon.
  monad: [
    ['Create your event', 'event_created', null], // existing
    ['Get approved', 'underboss_reviewed', null], // existing
    ['Confirm venue and Wi-Fi/power', 'venue_added', 'venue'], // existing
    ['Publish tracks, prizes and rules', null, 'details'], // existing
    ['Set up the submission platform', null, null],
    ['Post the day-by-day schedule', null, 'details'],
    ['Line up judges and mentors', null, null], // existing
    ['Add a co-host or volunteers', 'team_built', null], // existing
    ['Set capacity and review applications', null, 'guests'], // existing
    ['Plan meals per day: choose pizzerias', 'pizzerias_selected', 'pizza'], // existing
    ['Post to socials', null, 'social-post'],
    ['Pick a photo/video person', null, null],
    ['Day-of: check-in and displays', null, 'displays'], // existing
    ['Run demos and judging', null, null],
    ['Post winners and photos', null, 'photos'], // existing
    ['Send prizes to winners', null, null],
  ],
};

/**
 * Pure diff of a series' existing default rows against its planned list.
 * existing: [{ name, sort_order }]; planned: [[name, autoRule, linkTab], ...].
 * sortOrder is 1-based position in the plan.
 */
function planSeries(existing, planned) {
  const byName = new Map(existing.map((r) => [r.name, r]));
  const plannedNames = new Set(planned.map(([name]) => name));
  const insert = [];
  const reorder = [];
  const keep = [];
  planned.forEach(([name, autoRule, linkTab], i) => {
    const sortOrder = i + 1;
    const row = byName.get(name);
    if (!row) {
      insert.push({ name, autoRule, linkTab, isAuto: !!autoRule, sortOrder });
      return;
    }
    keep.push(name);
    if (row.sort_order !== sortOrder) reorder.push({ name, from: row.sort_order, to: sortOrder });
  });
  const extras = existing.filter((r) => !plannedNames.has(r.name)).map((r) => r.name);
  return { insert, reorder, keep, extras };
}

/** Returns a list of problems with the brand lists (empty = valid). */
function validateChecklists(lists = BRAND_CHECKLISTS) {
  const problems = [];
  for (const [slug, rows] of Object.entries(lists)) {
    const seen = new Set();
    for (const [name, rule, tab] of rows) {
      if (!name || name.length > 60) problems.push(`${slug}: bad name '${name}'`);
      if (seen.has(name)) problems.push(`${slug}: duplicate '${name}'`);
      seen.add(name);
      if (rule && !BRAND_AUTO_RULES.has(rule)) problems.push(`${slug}: auto rule '${rule}' not allowed`);
      if (tab && !VALID_LINK_TABS.has(tab)) problems.push(`${slug}: unknown link tab '${tab}'`);
    }
  }
  return problems;
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const { Client } = require('pg');
  const APPLY = process.argv.includes('--apply');

  const problems = validateChecklists();
  if (problems.length) {
    console.error('Invalid checklists:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not found (looked in backend/.env). Aborting.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log(`\n=== seed brand checklists (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);

  try {
    for (const [slug, planned] of Object.entries(BRAND_CHECKLISTS)) {
      await client.query(APPLY ? 'BEGIN' : 'BEGIN READ ONLY');
      try {
        const s = await client.query('SELECT id FROM event_series WHERE slug = $1', [slug]);
        if (!s.rows.length) {
          console.log(`\nSKIP '${slug}': series does not exist`);
          await client.query('ROLLBACK');
          continue;
        }
        const seriesId = s.rows[0].id;
        const ex = await client.query(
          'SELECT name, sort_order FROM checklist_defaults WHERE series_id = $1 ORDER BY sort_order, name',
          [seriesId],
        );
        const existingNames = ex.rows.map((r) => r.name);
        const threshold = existingNames.length;
        const { insert, reorder, keep, extras } = planSeries(ex.rows, planned);

        // Parties fully seeded from THIS series' template: they hold at least
        // `threshold` default items whose names are in the series template.
        const partiesRes = threshold === 0 ? { rows: [] } : await client.query(
          `SELECT p.id
             FROM parties p
            WHERE p.event_series_id = $1
              AND (SELECT COUNT(*) FROM checklist_items ci
                    WHERE ci.party_id = p.id AND ci.is_default = true
                      AND ci.name = ANY($2::text[])) >= $3`,
          [seriesId, existingNames, threshold],
        );
        const partyIds = partiesRes.rows.map((r) => r.id);
        const totalParties = await client.query(
          'SELECT COUNT(*)::int AS n FROM parties WHERE event_series_id = $1', [seriesId],
        );

        console.log(`\n--- '${slug}' (${seriesId}) ---`);
        console.log(`existing defaults: ${threshold}; planned: ${planned.length}; keep ${keep.length}, insert ${insert.length}, reorder ${reorder.length}`);
        if (insert.length) {
          console.log(`${APPLY ? 'Inserting' : 'Would insert'} ${insert.length} checklist_defaults row(s):`);
          for (const r of insert) {
            console.log(`  ${String(r.sortOrder).padStart(2)}. ${r.name}${r.autoRule ? `  [auto: ${r.autoRule}]` : ''}${r.linkTab ? `  -> ${r.linkTab}` : ''}`);
          }
        }
        if (reorder.length) {
          console.log(`${APPLY ? 'Reordering' : 'Would reorder'} ${reorder.length} existing row(s): ` +
            reorder.map((r) => `'${r.name}' ${r.from}->${r.to}`).join(', '));
        }
        if (extras.length) console.log(`Leaving alone (in DB, not in plan): ${extras.map((n) => `'${n}'`).join(', ')}`);
        if (threshold === 0) console.log('WARN: series had no defaults; its parties used the global template and are not backfilled.');
        console.log(`Parties in series: ${totalParties.rows[0].n}; fully seeded from series template: ${partyIds.length}` +
          (insert.length && partyIds.length ? ` -> ${APPLY ? 'backfilling' : 'would backfill'} ${insert.length} item(s) each (${insert.length * partyIds.length} checklist_items rows)` : ''));

        console.log('Final list:');
        planned.forEach(([name], i) => console.log(`  ${String(i + 1).padStart(2)}. ${name}${keep.includes(name) ? '' : '  (new)'}`));

        if (!APPLY) {
          await client.query('ROLLBACK');
          continue;
        }

        // (a) backfill already-seeded parties FIRST (see header).
        let backfilled = 0;
        if (partyIds.length) {
          for (const r of insert) {
            const res = await client.query(
              `INSERT INTO checklist_items
                 (id, party_id, name, due_date, is_auto, auto_rule, link_tab, sort_order, is_default, completed, created_at, updated_at)
               SELECT gen_random_uuid(), pid, $2, NULL, $3, $4, $5, $6, true, false, now(), now()
                 FROM unnest($1::uuid[]) AS pid
               ON CONFLICT (party_id, name) WHERE is_default = true DO NOTHING`,
              [partyIds, r.name, r.isAuto, r.autoRule, r.linkTab, r.sortOrder],
            );
            backfilled += res.rowCount;
          }
          for (const r of reorder) {
            await client.query(
              `UPDATE checklist_items SET sort_order = $3, updated_at = now()
                WHERE party_id = ANY($1::uuid[]) AND is_default = true AND name = $2`,
              [partyIds, r.name, r.to],
            );
          }
        }

        // (b) insert missing template rows.
        let inserted = 0;
        for (const r of insert) {
          const res = await client.query(
            `INSERT INTO checklist_defaults
               (id, name, due_date, is_auto, auto_rule, link_tab, sort_order, series_id, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, NULL, $2, $3, $4, $5, $6, now(), now())
             ON CONFLICT DO NOTHING`,
            [r.name, r.isAuto, r.autoRule, r.linkTab, r.sortOrder, seriesId],
          );
          inserted += res.rowCount;
        }

        // (c) realign existing template rows.
        for (const r of reorder) {
          await client.query(
            'UPDATE checklist_defaults SET sort_order = $3, updated_at = now() WHERE series_id = $1 AND name = $2',
            [seriesId, r.name, r.to],
          );
        }

        const after = await client.query(
          'SELECT COUNT(*)::int AS n FROM checklist_defaults WHERE series_id = $1', [seriesId],
        );
        const expected = threshold + insert.length;
        if (after.rows[0].n !== expected) {
          throw new Error(`'${slug}' has ${after.rows[0].n} defaults after insert, expected ${expected}`);
        }
        await client.query('COMMIT');
        console.log(`OK '${slug}': inserted ${inserted} default(s), backfilled ${backfilled} party item(s), reordered ${reorder.length}; now ${after.rows[0].n} defaults`);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    }
    if (!APPLY) console.log('\nDry run only. Re-run with --apply to write.\n');
  } finally {
    await client.end();
  }
}

module.exports = { BRAND_CHECKLISTS, BRAND_AUTO_RULES, VALID_LINK_TABS, planSeries, validateChecklists };

if (require.main === module) {
  main().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
  });
}
